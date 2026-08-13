#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR" || exit 1

clear
echo ""
echo "  ┌──────────────────────────────────┐"
echo "  │       LexRead 法研阅读器         │"
echo "  │       正在准备研究工作台…        │"
echo "  └──────────────────────────────────┘"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，LexRead 暂时无法启动。"
  echo "请先安装 Node.js 18 或更高版本，然后重新双击本启动器。"
  echo ""
  read -k 1 "?按任意键关闭窗口…"
  exit 1
fi

node "$PROJECT_DIR/scripts/launch-lexread.mjs"
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  echo ""
  echo "LexRead 启动失败，错误信息已显示在上方。"
  read -k 1 "?按任意键关闭窗口…"
fi

exit "$EXIT_CODE"
