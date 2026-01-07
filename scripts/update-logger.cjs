/**
 * 批量更新 logger 配置脚本
 */

const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'src/agents/tradingAgent.ts',
  'src/database/add-fee-column.ts',
  'src/database/check-trades.ts',
  'src/database/close-and-reset.ts',
  'src/database/init.ts',
  'src/database/reset.ts',
  'src/database/sync-from-gate.ts',
  'src/database/sync-positions-only.ts',
  'src/services/gateApiLocal.ts',
  'src/services/multiTimeframeAnalysis.ts'
];

function updateLoggerInFile(filePath) {
  console.log(`处理: ${filePath}`);

  let content = fs.readFileSync(filePath, 'utf-8');

  // 确定相对路径
  let relativePath;
  if (filePath.startsWith('src/database/')) {
    relativePath = '../../utils/logger';
  } else if (filePath.startsWith('src/services/')) {
    relativePath = '../utils/logger';
  } else if (filePath.startsWith('src/agents/')) {
    relativePath = '../utils/logger';
  }

  // 替换 import
  content = content.replace(
    /import { createPinoLogger } from "@voltagent\/logger";/g,
    `import { createLogger } from "${relativePath}";`
  );

  // 替换 logger 创建
  content = content.replace(
    /const logger = createPinoLogger\(\{\s*name: "([^"]+)",\s*level: "([^"]+)".*?\}\);/g,
    'const logger = createLogger("$1", "$2");'
  );

  // 写回文件
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  ✅ 已更新\n`);
}

// 执行更新
console.log('🔄 开始批量更新 logger 配置...\n');
filesToUpdate.forEach(file => {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) {
    updateLoggerInFile(fullPath);
  } else {
    console.log(`❌ 文件不存在: ${file}\n`);
  }
});

console.log('✅ 更新完成！');
console.log('\n请运行以下命令测试：');
console.log('  npm run build');
console.log('  docker compose -f docker-compose.prod.yml build');
