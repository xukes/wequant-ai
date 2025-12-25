import { execSync } from "child_process";

// 解决 Windows 下控制台输出中文乱码问题
export function fixConsoleEncoding() {
  if (process.platform === "win32") {
    try {
      // 尝试将当前终端的代码页切换为 UTF-8 (65001)
      // 使用 stdio: 'inherit' 确保命令作用于当前控制台
      execSync("chcp 65001", { stdio: "inherit" });
    } catch (e) {
      console.warn("Warning: Failed to switch console code page to UTF-8 (65001).");
    }

    // 强制设置 stdout 和 stderr 为 utf8 编码
    // 这对于 Node.js 正确输出中文至关重要
    if (process.stdout.isTTY) {
      process.stdout.setEncoding('utf8');
    }
    if (process.stderr.isTTY) {
      process.stderr.setEncoding('utf8');
    }
  }
}

// 自动执行一次
fixConsoleEncoding();
