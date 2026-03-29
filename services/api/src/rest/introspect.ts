import { query } from '../plugins/postgres'

export interface ColumnInfo {
  name: string
  dataType: string
  isNullable: boolean
  columnDefault: string | null
  isPrimaryKey: boolean
}

export interface TableInfo {
  name: string
  schema: string
  columns: ColumnInfo[]
}

// In-memory schema cache — refreshed every 60 seconds
let schemaCache: Map<string, TableInfo> = new Map()
let lastRefresh = 0
const CACHE_TTL_MS = 60_000

export async function introspectSchema(): Promise<Map<string, TableInfo>> {
  const now = Date.now()
  if (schemaCache.size > 0 && now - lastRefresh < CACHE_TTL_MS) {
    return schemaCache
  }

  const rows = await query<{
    table_name: string
    table_schema: string
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
    is_pk: boolean
  }>(`
    SELECT
      c.table_name,
      c.table_schema,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      COALESCE(pk.is_pk, false) as is_pk
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.table_name, kcu.column_name, true as is_pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
    ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name NOT LIKE 'pg_%'
    ORDER BY c.table_name, c.ordinal_position
  `)

  const newCache = new Map<string, TableInfo>()

  for (const row of rows) {
    if (!newCache.has(row.table_name)) {
      newCache.set(row.table_name, {
        name: row.table_name,
        schema: row.table_schema,
        columns: [],
      })
    }
    newCache.get(row.table_name)!.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
      columnDefault: row.column_default,
      isPrimaryKey: row.is_pk,
    })
  }

  schemaCache = newCache
  lastRefresh = now

  return newCache
}

export function invalidateSchemaCache(): void {
  schemaCache = new Map()
  lastRefresh = 0
}

export async function getTableInfo(tableName: string): Promise<TableInfo | null> {
  const schema = await introspectSchema()
  return schema.get(tableName) ?? null
}

export async function listTables(): Promise<TableInfo[]> {
  const schema = await introspectSchema()
  return Array.from(schema.values())
}
