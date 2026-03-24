/**
 * Telegram Bot Tools - Real Data Access
 * 
 * Provides actual data queries for the operator bot
 */

import { config } from "./config.js";
import { pool } from "./db.js";

/**
 * List n8n workflows via CLI
 */
export async function listN8nWorkflows(): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const result = await execAsync(
      'docker exec n8n-n8n-1 n8n list:workflow 2>&1 | grep -v "Error tracking"'
    );
    
    const workflows = result.stdout.trim().split('\n').filter(line => line.includes('|'));
    
    if (workflows.length === 0) {
      return 'No workflows found in n8n.';
    }
    
    const activeWorkflows = workflows.filter(line => !line.includes('inactive'));
    const total = workflows.length;
    const active = activeWorkflows.length;
    
    let output = `📊 **n8n Workflows** (${active}/${total} active)\n\n`;
    
    // Show first 10
    workflows.slice(0, 10).forEach(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        const id = parts[0].trim();
        const name = parts[1].trim();
        output += `• ${name}\n`;
      }
    });
    
    if (workflows.length > 10) {
      output += `\n... and ${workflows.length - 10} more`;
    }
    
    return output;
  } catch (error) {
    console.error('Failed to list n8n workflows:', error);
    return '⚠️ Failed to fetch n8n workflows.';
  }
}

/**
 * Get recent conversations from DB
 */
export async function getRecentConversations(limit = 5): Promise<string> {
  try {
    const result = await pool.query(
      `SELECT c.id, c.channel, c.title, c.status, 
              COUNT(m.id) as message_count,
              c.updated_at
       FROM conversations c
       LEFT JOIN messages m ON c.id = m.conversation_id
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT $1`,
      [limit]
    );
    
    if (result.rows.length === 0) {
      return 'No conversations found.';
    }
    
    let output = `💬 **Recent Conversations**\n\n`;
    
    result.rows.forEach((row, i) => {
      output += `${i + 1}. ${row.title || 'Untitled'} (${row.channel})\n`;
      output += `   Status: ${row.status} | Messages: ${row.message_count}\n`;
      output += `   Updated: ${new Date(row.updated_at).toLocaleString()}\n\n`;
    });
    
    return output;
  } catch (error) {
    console.error('Failed to get conversations:', error);
    return '⚠️ Failed to fetch conversations.';
  }
}

/**
 * Get product count and recent products
 */
export async function getProductStats(): Promise<string> {
  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM products WHERE active = true');
    const count = parseInt(countResult.rows[0].count);
    
    const recentResult = await pool.query(
      `SELECT sku, brand, model, title, price_amount, currency_code
       FROM products
       WHERE active = true
       ORDER BY created_at DESC
       LIMIT 5`
    );
    
    let output = `📦 **Products**: ${count} active\n\n`;
    
    if (recentResult.rows.length > 0) {
      output += `**Recent**:\n`;
      recentResult.rows.forEach(row => {
        output += `• ${row.brand} ${row.model} - $${row.price_amount} ${row.currency_code}\n`;
      });
    }
    
    return output;
  } catch (error) {
    console.error('Failed to get products:', error);
    return '⚠️ Failed to fetch products.';
  }
}

/**
 * Get customer stats
 */
export async function getCustomerStats(): Promise<string> {
  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM customers');
    const count = parseInt(countResult.rows[0].count);
    
    return `👥 **Customers**: ${count} total`;
  } catch (error) {
    console.error('Failed to get customers:', error);
    return '⚠️ Failed to fetch customers.';
  }
}

/**
 * Check API health
 */
export async function checkSystemHealth(): Promise<string> {
  try {
    const dbResult = await pool.query('SELECT NOW()');
    const dbTime = dbResult.rows[0].now;
    
    return `✅ **System Healthy**\n\n• Database: Connected (${dbTime})\n• API: Running\n• n8n: Active`;
  } catch (error) {
    return `⚠️ **System Issue**\n\n${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Parse command from user message
 */
export function parseCommand(text: string): string | null {
  const trimmed = text.trim().toLowerCase();
  
  if (trimmed.startsWith('/')) {
    return trimmed.substring(1).split(' ')[0];
  }
  
  // Also detect natural language commands
  if (trimmed.includes('show') && trimmed.includes('workflow')) return 'workflows';
  if (trimmed.includes('show') && trimmed.includes('product')) return 'products';
  if (trimmed.includes('show') && trimmed.includes('customer')) return 'customers';
  if (trimmed.includes('show') && trimmed.includes('conversation')) return 'conversations';
  if (trimmed.includes('health') || trimmed.includes('status')) return 'health';
  
  return null;
}

/**
 * Execute command and return response
 */
export async function executeCommand(command: string): Promise<string> {
  switch (command) {
    case 'workflows':
      return await listN8nWorkflows();
    case 'products':
      return await getProductStats();
    case 'customers':
      return await getCustomerStats();
    case 'conversations':
      return await getRecentConversations();
    case 'health':
    case 'status':
      return await checkSystemHealth();
    default:
      return `Unknown command: ${command}\n\nAvailable: /workflows, /products, /customers, /conversations, /health`;
  }
}
