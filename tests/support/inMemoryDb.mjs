function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function keyString(key) {
  return `${key.pk}||${key.sk}`;
}

function parseSetAssignments(updateExpression) {
  const expr = updateExpression.trim();
  if (!expr.startsWith("SET ")) return [];
  const body = expr.slice(4);
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function resolveAttrName(token, names = {}) {
  const trimmed = token.trim();
  if (trimmed.startsWith("#")) return names[trimmed] || trimmed.slice(1);
  return trimmed;
}

function applyUpdateExpression(item, updateExpression, names, values) {
  // Handle SET clause (may appear anywhere in the expression)
  const setClauseMatch = /\bSET\s+([\s\S]*?)(?=\s+\b(?:ADD|REMOVE|DELETE)\b|$)/i.exec(updateExpression);
  if (setClauseMatch) {
    for (const assignment of parseSetAssignments("SET " + setClauseMatch[1].trim())) {
      const [lhsRaw, rhsRaw] = assignment.split("=").map((s) => s.trim());
      const lhs = resolveAttrName(lhsRaw, names);
      if (rhsRaw.startsWith("if_not_exists(")) {
        const inner = rhsRaw.slice("if_not_exists(".length, -1);
        const [attrToken, fallbackToken] = inner.split(",").map((s) => s.trim());
        const attr = resolveAttrName(attrToken, names);
        if (item[attr] === undefined) {
          item[lhs] = clone(values[fallbackToken]);
        }
        continue;
      }
      item[lhs] = clone(values[rhsRaw]);
    }
  }

  // Handle ADD clause (atomic numeric increment)
  const addClauseMatch = /\bADD\s+([\s\S]*?)(?=\s+\b(?:SET|REMOVE|DELETE)\b|$)/i.exec(updateExpression);
  if (addClauseMatch) {
    for (const part of addClauseMatch[1].split(",").map((s) => s.trim())) {
      if (!part) continue;
      const tokens = part.split(/\s+/);
      if (tokens.length < 2) continue;
      const attr = resolveAttrName(tokens[0], names);
      const val = values[tokens[1]];
      if (val !== undefined) item[attr] = (item[attr] ?? 0) + Number(val);
    }
  }
}

/**
 * Evaluate a DynamoDB-style condition expression against an item.
 * Supports: attribute_not_exists, attribute_exists, <, <=, =, AND, OR.
 * Unknown conditions fail open (return true) to avoid blocking real ops.
 */
function evaluateCondition(item, conditionExp, names, values) {
  if (!conditionExp) return true;
  const expr = conditionExp.trim();

  // OR — split and require at least one branch to pass
  const orParts = expr.split(/\s+OR\s+/i);
  if (orParts.length > 1) {
    return orParts.some((p) => evaluateCondition(item, p.trim(), names, values));
  }

  // AND — split and require all branches to pass
  const andParts = expr.split(/\s+AND\s+/i);
  if (andParts.length > 1) {
    return andParts.every((p) => evaluateCondition(item, p.trim(), names, values));
  }

  // attribute_not_exists(attr)
  const notExistsMatch = /^attribute_not_exists\(\s*(#?\w+)\s*\)$/i.exec(expr);
  if (notExistsMatch) {
    const attr = resolveAttrName(notExistsMatch[1], names);
    return item[attr] === undefined;
  }

  // attribute_exists(attr)
  const existsMatch = /^attribute_exists\(\s*(#?\w+)\s*\)$/i.exec(expr);
  if (existsMatch) {
    const attr = resolveAttrName(existsMatch[1], names);
    return item[attr] !== undefined;
  }

  // attr < :val
  const ltMatch = /^(#?\w+)\s*<\s*(:\w+)$/.exec(expr);
  if (ltMatch) {
    const attr = resolveAttrName(ltMatch[1], names);
    return (item[attr] ?? 0) < values[ltMatch[2]];
  }

  // attr <= :val
  const lteMatch = /^(#?\w+)\s*<=\s*(:\w+)$/.exec(expr);
  if (lteMatch) {
    const attr = resolveAttrName(lteMatch[1], names);
    return (item[attr] ?? 0) <= values[lteMatch[2]];
  }

  // attr = :val
  const eqMatch = /^(#?\w+)\s*=\s*(:\w+)$/.exec(expr);
  if (eqMatch) {
    const attr = resolveAttrName(eqMatch[1], names);
    return item[attr] === values[eqMatch[2]];
  }

  return true; // unknown condition → fail open
}

export function createInMemoryDbFactory() {
  const tables = new Map(); // tableName -> Map(keyString -> item)

  function tableStore(tableName) {
    let store = tables.get(tableName);
    if (!store) {
      store = new Map();
      tables.set(tableName, store);
    }
    return store;
  }

  function db(tableName) {
    const store = tableStore(tableName);

    return {
      async put(item) {
        store.set(keyString(item), clone(item));
        return {};
      },
      async get(key) {
        return { Item: clone(store.get(keyString(key))) };
      },
      async update(key, updateExp, names = {}, values = {}, conditionExp) {
        const k = keyString(key);
        const current = clone(store.get(k)) || { ...clone(key) };

        if (conditionExp && !evaluateCondition(current, conditionExp, names, values)) {
          const err = new Error("The conditional request failed");
          err.name = "ConditionalCheckFailedException";
          throw err;
        }

        applyUpdateExpression(current, updateExp, names, values);
        store.set(k, current);
        return { Attributes: clone(current) };
      },
      async delete(key) {
        store.delete(keyString(key));
        return {};
      },
      async scan(_filterExp, _values) {
        return { Items: Array.from(store.values()).map(clone) };
      },
      async query(keyCondition, values, _indexName) {
        // Minimal support for "pk = :pk" and "pk = :pk AND begins_with(sk, :sk)"
        const items = Array.from(store.values());
        const pkMatch = /pk\s*=\s*(:[A-Za-z0-9_]+)/.exec(String(keyCondition || ""));
        if (!pkMatch) return { Items: items.map(clone) };
        const pkValue = values?.[pkMatch[1]];
        let filtered = items.filter((i) => i.pk === pkValue);
        const beginsMatch = /begins_with\s*\(\s*sk\s*,\s*(:[A-Za-z0-9_]+)\s*\)/.exec(String(keyCondition));
        if (beginsMatch) {
          const skPrefix = values?.[beginsMatch[1]];
          filtered = filtered.filter((i) => String(i.sk).startsWith(skPrefix));
        }
        return { Items: filtered.map(clone) };
      }
    };
  }

  db._dumpTable = (tableName) => Array.from(tableStore(tableName).values()).map(clone);
  return db;
}
