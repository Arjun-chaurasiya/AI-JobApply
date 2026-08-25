#!/bin/bash
cd "$(dirname "$0")"

PORT=3000
URL="http://localhost:$PORT"

if curl -s -o /dev/null "$URL"; then
  echo "JobApply AI is already running — opening browser."
  open "$URL"
  exit 0
fi

echo "Starting JobApply AI..."
npm run dev &
SERVER_PID=$!

for i in $(seq 1 30); do
  if curl -s -o /dev/null "$URL"; then
    open "$URL"
    break
  fi
  sleep 1
done

wait $SERVER_PID
