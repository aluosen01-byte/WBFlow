// 更新 .env 中 WB_USERS 里罗世伟的令牌（保持用户顺序）
import fs from 'node:fs';

const envPath = 'D:/projects/WBFlow/.env';
let env = fs.readFileSync(envPath, 'utf8');

const line = env.split(/\r?\n/).find((l) => l.startsWith('WB_USERS='));
if (!line) { console.error('WB_USERS 行未找到'); process.exit(1); }

const users = JSON.parse(line.slice('WB_USERS='.length));
const NEW_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYwMzAydjEiLCJ0eXAiOiJKV1QifQ.eyJhY2MiOjMsImVudCI6MSwiZXhwIjoxODAzNTgxODMxLCJmb3IiOiJzZWxmIiwiaWQiOiIwMWEwNDIwMi0yNGY2LTdkY2UtODAxYy1iODA0NmIwZjQ1ZGEiLCJpaWQiOjMxODcyMTc5OCwib2lkIjoyNTAxODI5MjksInMiOjgxNjYyLCJzaWQiOiJjYjkwZThlYS05NTc0LTRkODQtYWZlNy1hNDdmMTI5N2MwMDYiLCJ0IjpmYWxzZSwidWlkIjozMTg3MjE3OTh9.Y_4p1aCdvLOg7oTTvh0qXcxR7Cb9bXSqBkSV9CfJQ6NBTOnoNOlfWfnHROkZo4hroCTY1tssoRhQROEUg1QNyA';

if (!users['罗世伟']) { console.error('未找到 罗世伟'); process.exit(1); }
users['罗世伟'] = NEW_TOKEN;

const newLine = 'WB_USERS=' + JSON.stringify(users);
env = env.replace(line, newLine);
fs.writeFileSync(envPath, env);
console.log('已更新 罗世伟 令牌（for=self，个人令牌）');
// 校验
const reloaded = JSON.parse(newLine.slice('WB_USERS='.length));
console.log('用户顺序:', Object.keys(reloaded).join(' / '));
console.log('罗世伟 for 字段:', JSON.parse(Buffer.from(NEW_TOKEN.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).for);
