/**
 * 修复 logger 创建语句
 */

const fs = require('fs');
const path = require('path');

const filesToUpdate = [
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

function fixLoggerCreation(filePath) {
  console.log(`处理: ${filePath}`);

  let content = fs.readFileSync(filePath, 'utf-8');

  // 替换多行 logger 创建为单行
  const pattern = /const logger = createPinoLogger\(\{\s*name: "([^"]+)",\s*level: "([^"]+)".*?\}\);/g;
  content = content.replace(pattern, (match, name, level) => {
    return `const logger = createLogger("${name}", "${level}");`;
  });

  // 写回文件
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  ✅ 已修复\n`);
}

console.log('🔄 修复 logger 创建语句...\n');
filesToUpdate.forEach(file => {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) {
    fixLoggerCreation(fullPath);
  } else {
    console.log(`❌ 文件不存在: ${file}\n`);
  }
});

console.log('✅ 修复完成！');
