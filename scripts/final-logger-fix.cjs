/**
 * 最终修复脚本 - 修复所有剩余的 logger 创建语句
 */

const fs = require('fs');
const path = require('path');

const filesToFix = [
  { file: 'src/database/add-fee-column.ts', name: 'db-migration-fee' },
  { file: 'src/database/check-trades.ts', name: 'check-trades' },
  { file: 'src/database/close-and-reset.ts', name: 'close-reset' },
  { file: 'src/database/reset.ts', name: 'db-reset' },
  { file: 'src/database/sync-from-gate.ts', name: 'sync-from-gate' },
  { file: 'src/database/sync-positions-only.ts', name: 'sync-positions' },
  { file: 'src/services/gateApiLocal.ts', name: 'gate-api-local' },
  { file: 'src/services/multiTimeframeAnalysis.ts', name: 'multi-timeframe' }
];

filesToFix.forEach(({ file, name }) => {
  const fullPath = path.join(process.cwd(), file);

  if (!fs.existsSync(fullPath)) {
    console.log(`❌ 文件不存在: ${file}`);
    return;
  }

  console.log(`处理: ${file}`);

  let content = fs.readFileSync(fullPath, 'utf-8');

  // 替换 logger 创建语句
  const patterns = [
    /const logger = createPinoLogger\(\{\s*name: "([^"]+)",\s*level: "([^"]+)"\s*\}\);?/g,
    /const logger = createPinoLogger\(\{\s*level: "([^"]+)",\s*name: "([^"]+)"\s*\}\);?/g
  ];

  patterns.forEach(pattern => {
    content = content.replace(pattern, (match, p1, p2) => {
      // 判断哪个参数是 name，哪个是 level
      const loggerName = p1.length > 5 ? p1 : p2; // name 通常更长
      const logLevel = p1.length > 5 ? p2 : p1;
      return `const logger = createLogger("${loggerName}", "${logLevel}");`;
    });
  });

  fs.writeFileSync(fullPath, content, 'utf-8');
  console.log(`  ✅ 已修复为: createLogger("${name}", "info")\n`);
});

console.log('\n✅ 所有文件已修复！');
