import { ColumnInfo } from './introspect'

export interface ParsedQuery {
  select: string[]
  filters: Filter[]
  order: OrderClause[]
  limit: number
  offset: number
}

interface Filter {
  column: string
  operator: string
  value: unknown
}

interface OrderClause {
  column: string
  direction: 'ASC' | 'DESC'
}

// Supabase-compatible operators
const OPERATOR_MAP: Record<string, string> = {
  eq:    '=',
  neq:   '!=',
  gt:    '>',
  gte:   '>=',
  lt:    '<',
  lte:   '<=',
  like:  'LIKE',
  ilike: 'ILIKE',
  is:    'IS',
  in:    '= ANY',
}

// Reserved query params — not treated as column filters
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset'])

export function parseQueryParams(
  queryParams: Record<string, string | string[]>,
  columns: ColumnInfo[]
): ParsedQuery {
  const columnNames = new Set(columns.map((c) => c.name))
  const result: ParsedQuery = {
    select: [],
    filters: [],
    order: [],
    limit: 100,
    offset: 0,
  }

  for (const [param, rawValue] of Object.entries(queryParams)) {
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue

    if (param === 'select') {
      result.select = value.split(',').map((s) => s.trim()).filter(Boolean)
      continue
    }

    if (param === 'order') {
      // e.g. order=created_at.desc,name.asc
      const parts = value.split(',')
      for (const part of parts) {
        const [col, dir] = part.trim().split('.')
        if (columnNames.has(col)) {
          result.order.push({
            column: col,
            direction: dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC',
          })
        }
      }
      continue
    }

    if (param === 'limit') {
      const n = parseInt(value)
      if (!isNaN(n) && n > 0 && n <= 10000) result.limit = n
      continue
    }

    if (param === 'offset') {
      const n = parseInt(value)
      if (!isNaN(n) && n >= 0) result.offset = n
      continue
    }

    // Column filter: ?column_name=operator.value
    if (columnNames.has(param)) {
      const dotIndex = value.indexOf('.')
      if (dotIndex === -1) continue

      const operator = value.substring(0, dotIndex)
      const rawVal = value.substring(dotIndex + 1)

      if (!OPERATOR_MAP[operator]) continue

      let parsedValue: unknown = rawVal

      // Handle special values
      if (operator === 'is') {
        if (rawVal === 'null') parsedValue = null
        else if (rawVal === 'true') parsedValue = true
        else if (rawVal === 'false') parsedValue = false
        else continue
      } else if (operator === 'in') {
        // e.g. id=in.(1,2,3)
        const inner = rawVal.replace(/^\(|\)$/g, '')
        parsedValue = inner.split(',').map((v) => v.trim())
      }

      result.filters.push({ column: param, operator, value: parsedValue })
    }
  }

  return result
}

export interface BuiltQuery {
  sql: string
  params: unknown[]
}

export function buildSelectQuery(
  tableName: string,
  parsed: ParsedQuery,
  columns: ColumnInfo[]
): BuiltQuery {
  const params: unknown[] = []
  let paramIndex = 1

  // SELECT clause
  const allColumnNames = columns.map((c) => c.name)
  const selectedCols = parsed.select.length > 0
    ? parsed.select.filter((c) => allColumnNames.includes(c))
    : ['*']

  // Safely quote column names
  const selectClause = selectedCols.map((c) => c === '*' ? '*' : `"${c}"`).join(', ')

  let sql = `SELECT ${selectClause} FROM ${tableName}`

  // WHERE clause
  const whereParts: string[] = []
  for (const filter of parsed.filters) {
    const col = `"${filter.column}"`
    const op = OPERATOR_MAP[filter.operator]

    if (filter.operator === 'is') {
      if (filter.value === null) {
        whereParts.push(`${col} IS NULL`)
      } else {
        whereParts.push(`${col} IS ${filter.value}`)
      }
    } else if (filter.operator === 'in') {
      params.push(filter.value)
      whereParts.push(`${col} = ANY($${paramIndex++})`)
    } else {
      params.push(filter.value)
      whereParts.push(`${col} ${op} $${paramIndex++}`)
    }
  }

  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.join(' AND ')}`
  }

  // ORDER BY
  if (parsed.order.length > 0) {
    const orderClause = parsed.order.map((o) => `"${o.column}" ${o.direction}`).join(', ')
    sql += ` ORDER BY ${orderClause}`
  }

  // LIMIT / OFFSET
  sql += ` LIMIT $${paramIndex++}`
  params.push(parsed.limit)

  sql += ` OFFSET $${paramIndex++}`
  params.push(parsed.offset)

  return { sql, params }
}

export function buildInsertQuery(
  tableName: string,
  body: Record<string, unknown>,
  columns: ColumnInfo[]
): BuiltQuery {
  const columnNames = new Set(columns.map((c) => c.name))
  const insertCols: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(body)) {
    if (columnNames.has(key)) {
      insertCols.push(key)
      values.push(value)
    }
  }

  if (insertCols.length === 0) {
    // No user-supplied columns — let PostgreSQL use all column defaults
    return { sql: `INSERT INTO ${tableName} DEFAULT VALUES RETURNING *`, params: [] }
  }

  const colList = insertCols.map((c) => `"${c}"`).join(', ')
  const valList = insertCols.map((_, i) => `$${i + 1}`).join(', ')
  const sql = `INSERT INTO ${tableName} (${colList}) VALUES (${valList}) RETURNING *`

  return { sql, params: values }
}

export function buildUpdateQuery(
  tableName: string,
  body: Record<string, unknown>,
  parsed: ParsedQuery,
  columns: ColumnInfo[]
): BuiltQuery {
  const columnNames = new Set(columns.map((c) => c.name))
  const setCols: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(body)) {
    if (columnNames.has(key)) {
      setCols.push(`"${key}" = $${paramIndex++}`)
      params.push(value)
    }
  }

  if (setCols.length === 0) {
    throw new Error('No valid columns provided for update')
  }

  let sql = `UPDATE ${tableName} SET ${setCols.join(', ')}`

  // WHERE clause (same logic as SELECT)
  const whereParts: string[] = []
  for (const filter of parsed.filters) {
    const col = `"${filter.column}"`
    const op = OPERATOR_MAP[filter.operator]

    if (filter.operator === 'is') {
      whereParts.push(filter.value === null ? `${col} IS NULL` : `${col} IS ${filter.value}`)
    } else if (filter.operator === 'in') {
      params.push(filter.value)
      whereParts.push(`${col} = ANY($${paramIndex++})`)
    } else {
      params.push(filter.value)
      whereParts.push(`${col} ${op} $${paramIndex++}`)
    }
  }

  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.join(' AND ')}`
  }

  sql += ' RETURNING *'

  return { sql, params }
}

export function buildDeleteQuery(
  tableName: string,
  parsed: ParsedQuery
): BuiltQuery {
  const params: unknown[] = []
  let paramIndex = 1

  let sql = `DELETE FROM ${tableName}`

  const whereParts: string[] = []
  for (const filter of parsed.filters) {
    const col = `"${filter.column}"`
    const op = OPERATOR_MAP[filter.operator]

    if (filter.operator === 'is') {
      whereParts.push(filter.value === null ? `${col} IS NULL` : `${col} IS ${filter.value}`)
    } else if (filter.operator === 'in') {
      params.push(filter.value)
      whereParts.push(`${col} = ANY($${paramIndex++})`)
    } else {
      params.push(filter.value)
      whereParts.push(`${col} ${op} $${paramIndex++}`)
    }
  }

  if (whereParts.length === 0) {
    throw new Error('DELETE without filters is not allowed — add at least one filter')
  }

  sql += ` WHERE ${whereParts.join(' AND ')} RETURNING *`

  return { sql, params }
}
