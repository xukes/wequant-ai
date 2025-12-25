import { spawn, execSync } from 'child_process';
import { platform } from 'os';

// 在 Windows 上设置代码页为 UTF-8 (65001)
if (platform() === 'win32') {
  try {
    // 使用 stdio: 'inherit' 确保命令作用于当前控制台
    execSync('chcp 65001', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Warning: Failed to switch console code page to UTF-8 (65001).');
  }
}

// 获取要运行的命令和参数
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Please provide a command to run.');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

// 运行命令
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    // 强制 Node.js 使用 UTF-8
    NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --enable-source-maps',
    LANG: 'zh_CN.UTF-8',
    LC_ALL: 'zh_CN.UTF-8'
  }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Failed to start subprocess:', err);
  process.exit(1);
});
