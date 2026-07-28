/**
 * Mochi AI Chat - JSON文件数据库模块 v2.0
 * 替代 better-sqlite3，纯JS实现，零编译依赖
 * 
 * v2.0 更新：
 * - 新增 recharge_orders 表（充值订单）
 * - 优化写入性能
 * - 修复 COALESCE 解析
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 表定义
const TABLES = {
  users: 'users.json',
  characters: 'characters.json',
  conversations: 'conversations.json',
  messages: 'messages.json',
  transactions: 'transactions.json',
  community_characters: 'community.json',
  orders: 'orders.json',
  recharge_orders: 'recharge_orders.json',
  // 论坛系统
  forum_posts: 'forum_posts.json',
  forum_comments: 'forum_comments.json',
  forum_likes: 'forum_likes.json',
  forum_follows: 'forum_follows.json',
  // 同人文系统
  fanfic_works: 'fanfic_works.json',
  fanfic_shelf: 'fanfic_shelf.json'
};

// 内存缓存
const cache = {};
const writeTimers = {};

// ==================== 基础读写 ====================
function readTable(tableName) {
  if (cache[tableName]) {
    return cache[tableName];
  }
  
  const fileName = TABLES[tableName];
  const filePath = path.join(DATA_DIR, fileName);
  
  if (!fs.existsSync(filePath)) {
    cache[tableName] = [];
    return [];
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    cache[tableName] = data;
    return data;
  } catch (err) {
    console.error(`读取表 ${tableName} 失败:`, err);
    cache[tableName] = [];
    return [];
  }
}

function writeTable(tableName, data) {
  cache[tableName] = data;
  
  // 防抖写入，避免频繁IO
  if (writeTimers[tableName]) {
    clearTimeout(writeTimers[tableName]);
  }
  
  writeTimers[tableName] = setTimeout(() => {
    const fileName = TABLES[tableName];
    const filePath = path.join(DATA_DIR, fileName);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`写入表 ${tableName} 失败:`, err);
    }
  }, 100);
}

// ==================== Statement 类 ====================
class Statement {
  constructor(tableName, sql, params = []) {
    this.tableName = tableName;
    this.sql = sql.trim();
    this.params = params;
  }
  
  // 绑定参数
  bind(...args) {
    this.params = args.flat();
    return this;
  }
  
  // 获取单条记录
  get(...args) {
    if (args.length > 0) {
      this.params = args.flat();
    }
    const table = readTable(this.tableName);
    const result = this._executeSelect(table);
    return result[0] || undefined;
  }
  
  // 获取所有记录
  all(...args) {
    if (args.length > 0) {
      this.params = args.flat();
    }
    const table = readTable(this.tableName);
    return this._executeSelect(table);
  }
  
  // 执行（插入、更新、删除）
  run(...args) {
    if (args.length > 0) {
      this.params = args.flat();
    }
    const table = readTable(this.tableName);
    
    if (this.sql.toUpperCase().startsWith('INSERT')) {
      return this._executeInsert(table);
    } else if (this.sql.toUpperCase().startsWith('UPDATE')) {
      return this._executeUpdate(table);
    } else if (this.sql.toUpperCase().startsWith('DELETE')) {
      return this._executeDelete(table);
    }
    
    return { changes: 0 };
  }
  
  // ==================== SQL解析执行 ====================
  _executeSelect(table) {
    let result = [...table];
    
    // 解析 WHERE 条件
    const whereMatch = this.sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/i);
    if (whereMatch) {
      const whereClause = whereMatch[1].trim();
      result = this._applyWhere(result, whereClause);
    }
    
    // 解析 ORDER BY
    const orderMatch = this.sql.match(/ORDER\s+BY\s+(.+?)(?:LIMIT|$)/i);
    if (orderMatch) {
      const orderClause = orderMatch[1].trim();
      result = this._applyOrderBy(result, orderClause);
    }
    
    // 解析 LIMIT/OFFSET
    const limitMatch = this.sql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      const offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
      result = result.slice(offset, offset + limit);
    }
    
    return result;
  }
  
  _executeInsert(table) {
    // 解析 INSERT INTO table (col1, col2) VALUES (?, ?)
    const match = this.sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!match) {
      return { changes: 0 };
    }
    
    const columns = match[2].split(',').map(c => c.trim());
    const values = this.params;
    
    const newRow = { id: this._getNextId(table) };
    columns.forEach((col, index) => {
      newRow[col] = values[index];
    });
    
    table.push(newRow);
    writeTable(this.tableName, table);
    
    return {
      lastInsertRowid: newRow.id,
      changes: 1
    };
  }
  
  _executeUpdate(table) {
    // 解析 UPDATE table SET col1=?, col2=? WHERE ...
    const match = this.sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:WHERE|$)/i);
    if (!match) {
      return { changes: 0 };
    }
    
    const setClause = match[2].trim();
    const whereMatch = this.sql.match(/WHERE\s+(.+)$/i);
    const whereClause = whereMatch ? whereMatch[1].trim() : null;
    
    // 解析 SET 子句
    const setPairs = this._parseSetClause(setClause);
    const setValues = {};
    let paramIndex = 0;
    
    setPairs.forEach(pair => {
      const { col, val, isCoalesce } = pair;
      
      if (val === '?') {
        setValues[col] = this.params[paramIndex++];
      } else if (isCoalesce) {
        // 处理 COALESCE(?, col) 模式
        const paramVal = this.params[paramIndex++];
        if (paramVal !== null && paramVal !== undefined) {
          setValues[col] = paramVal;
        }
      } else {
        // 尝试解析数字或字符串
        if (val.startsWith("'") && val.endsWith("'")) {
          setValues[col] = val.slice(1, -1);
        } else if (!isNaN(val)) {
          setValues[col] = Number(val);
        }
      }
    });
    
    // 应用 WHERE 条件
    let count = 0;
    table.forEach(row => {
      if (!whereClause || this._matchCondition(row, whereClause)) {
        Object.assign(row, setValues);
        count++;
      }
    });
    
    if (count > 0) {
      writeTable(this.tableName, table);
    }
    
    return { changes: count };
  }
  
  _parseSetClause(setClause) {
    const pairs = [];
    let i = 0;
    let current = '';
    let depth = 0;
    
    while (i < setClause.length) {
      const char = setClause[i];
      
      if (char === '(') depth++;
      if (char === ')') depth--;
      
      if (char === ',' && depth === 0) {
        pairs.push(this._parseSetPair(current.trim()));
        current = '';
      } else {
        current += char;
      }
      i++;
    }
    
    if (current.trim()) {
      pairs.push(this._parseSetPair(current.trim()));
    }
    
    return pairs;
  }
  
  _parseSetPair(pairStr) {
    // 处理 COALESCE(?, col) 模式
    const coalesceMatch = pairStr.match(/(\w+)\s*=\s*COALESCE\(\s*\?\s*,\s*(\w+)\s*\)/i);
    if (coalesceMatch) {
      return {
        col: coalesceMatch[1],
        val: '?',
        isCoalesce: true
      };
    }
    
    // 普通 col = ? 模式
    const eqIndex = pairStr.indexOf('=');
    if (eqIndex > -1) {
      return {
        col: pairStr.slice(0, eqIndex).trim(),
        val: pairStr.slice(eqIndex + 1).trim(),
        isCoalesce: false
      };
    }
    
    return { col: pairStr, val: '', isCoalesce: false };
  }
  
  _executeDelete(table) {
    const whereMatch = this.sql.match(/WHERE\s+(.+)$/i);
    const whereClause = whereMatch ? whereMatch[1].trim() : null;
    
    let count = 0;
    const newTable = table.filter(row => {
      if (!whereClause || this._matchCondition(row, whereClause)) {
        count++;
        return false;
      }
      return true;
    });
    
    if (count > 0) {
      writeTable(this.tableName, newTable);
    }
    
    return { changes: count };
  }
  
  // ==================== 条件匹配 ====================
  _applyWhere(rows, whereClause) {
    return rows.filter(row => this._matchCondition(row, whereClause));
  }
  
  _matchCondition(row, whereClause) {
    // 简单的 AND 条件解析
    const conditions = whereClause.split(/\s+AND\s+/i);
    let paramIndex = 0;
    
    for (const cond of conditions) {
      const match = cond.match(/(\w+)\s*(=|>|<|>=|<=|!=|LIKE)\s*(.+)/i);
      if (!match) continue;
      
      const [, col, op, valStr] = match;
      let val;
      
      if (valStr === '?') {
        val = this.params[paramIndex++];
      } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
        val = valStr.slice(1, -1);
      } else if (!isNaN(valStr)) {
        val = Number(valStr);
      } else {
        val = valStr;
      }
      
      const rowVal = row[col];
      
      switch (op) {
        case '=':
          if (rowVal != val) return false;
          break;
        case '!=':
          if (rowVal == val) return false;
          break;
        case '>':
          if (!(rowVal > val)) return false;
          break;
        case '<':
          if (!(rowVal < val)) return false;
          break;
        case '>=':
          if (!(rowVal >= val)) return false;
          break;
        case '<=':
          if (!(rowVal <= val)) return false;
          break;
        case 'LIKE':
          // 简单的 LIKE 支持，% 作为通配符
          const pattern = new RegExp('^' + val.replace(/%/g, '.*').replace(/\?/g, '.') + '$', 'i');
          if (!pattern.test(String(rowVal || ''))) return false;
          break;
      }
    }
    
    return true;
  }
  
  _applyOrderBy(rows, orderClause) {
    const [col, direction] = orderClause.split(/\s+/);
    const dir = direction && direction.toUpperCase() === 'DESC' ? -1 : 1;
    
    return [...rows].sort((a, b) => {
      const aVal = a[col];
      const bVal = b[col];
      
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  }
  
  _getNextId(table) {
    if (table.length === 0) return 1;
    return Math.max(...table.map(r => r.id || 0)) + 1;
  }
}

// ==================== Database 类 ====================
class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    // 预加载所有表
    Object.keys(TABLES).forEach(tableName => {
      readTable(tableName);
    });
  }
  
  prepare(sql) {
    // 从SQL中提取表名
    const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
    const tableName = tableMatch ? tableMatch[1] : null;
    
    if (!tableName || !TABLES[tableName]) {
      // 对于不认识的表，返回一个空statement
      return new Statement('', sql);
    }
    
    return new Statement(tableName, sql);
  }
  
  exec(sql) {
    // 执行多条SQL（用分号分隔）
    const statements = sql.split(';').filter(s => s.trim());
    statements.forEach(stmt => {
      if (stmt.trim()) {
        const s = this.prepare(stmt);
        s.run();
      }
    });
  }
  
  pragma() {
    // 兼容 better-sqlite3 的 pragma 调用，空实现
  }
}

// ==================== 导出 ====================
module.exports = Database;
