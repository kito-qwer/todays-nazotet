#!/bin/bash
set -e

file="data/archive.json"
today=$(date -d '9 hours' +%Y%m%d).dat  # 日本時間の日付
datapath="data/$today"

# データファイルが存在しないなら終了
if [ ! -f "$datapath" ]; then
	echo "File $datapath not found, skip."
	exit 0
fi

# すでに archive.json に含まれているなら終了
if grep -q "\"$today\"" "$file"; then
	echo "$today already exists in $file"
	exit 0
fi

# jq を使って末尾に追加
tmp=$(mktemp)
jq ". + [\"$today\"]" "$file" > "$tmp" && mv "$tmp" "$file"
echo "Appended $today to $file"
