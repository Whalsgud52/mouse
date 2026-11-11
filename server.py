import asyncio
import json
import math
import os
import secrets
import ssl
import time
from pathlib import Path

import pyautogui
import websockets

HOST = os.getenv('MOUSE_HOST', '0.0.0.0')
PORT = int(os.getenv('MOUSE_PORT', '8765'))
TOKEN = os.getenv('MOUSE_PAIR_TOKEN') or secrets.token_urlsafe(24)
CERT = os.getenv('MOUSE_TLS_CERT', '')
KEY = os.getenv('MOUSE_TLS_KEY', '')
MAX_STEP = 80.0
MAX_RATE = 120

# PC 공통 기본 배율: A의 X/Y 개별 감도와 곱해져 적용됩니다.
# 예) 아이폰 X=3, Y=6 / PC=4 -> 유효 X=12배, Y=24배
# C가 테스트 중에만 변경하고, 사용자는 아이폰에서 축별 감도를 조절합니다.
PC_SENSITIVITY = float(os.getenv('MOUSE_PC_SENSITIVITY', '4.0'))
if not math.isfinite(PC_SENSITIVITY) or not 0.1 <= PC_SENSITIVITY <= 10:
    raise ValueError('MOUSE_PC_SENSITIVITY must be between 0.1 and 10.')

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0

async def handle(ws):
    authenticated = False
    last_move = 0.0
    remainder_x = remainder_y = 0.0
    try:
        async for raw in ws:
            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    continue
            except (json.JSONDecodeError, TypeError):
                continue
            if not authenticated:
                if data.get('type') != 'pair' or not isinstance(data.get('token'), str) or not secrets.compare_digest(data['token'], TOKEN):
                    await ws.send(json.dumps({'type': 'paired', 'ok': False}))
                    await ws.close(code=1008, reason='Authentication failed')
                    return
                authenticated = True
                await ws.send(json.dumps({'type': 'paired', 'ok': True}))
                print('iPhone paired')
                continue
            if data.get('type') != 'move':
                continue
            dx, dy = data.get('dx'), data.get('dy')
            if isinstance(dx, bool) or isinstance(dy, bool) or not isinstance(dx, (int, float)) or not isinstance(dy, (int, float)):
                continue
            if not math.isfinite(dx) or not math.isfinite(dy) or abs(dx) > MAX_STEP or abs(dy) > MAX_STEP:
                continue
            now = time.monotonic()
            if now - last_move < 1 / MAX_RATE:
                continue
            last_move = now
            # MAX_STEP 검증은 원본 수신값 기준으로 진행하고,
            # 소수점 누적 전에 PC 공통 감도를 적용합니다.
            remainder_x += dx * PC_SENSITIVITY
            remainder_y += dy * PC_SENSITIVITY
            mx, my = math.trunc(remainder_x), math.trunc(remainder_y)
            remainder_x -= mx
            remainder_y -= my
            if mx or my:
                pyautogui.moveRel(mx, my, duration=0)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print('iPhone disconnected')

async def main():
    ssl_context = None
    if CERT and KEY:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(CERT, KEY)
    print(f'Listening on {HOST}:{PORT} ({"WSS" if ssl_context else "WS"})')
    print(f'PC cursor sensitivity: {PC_SENSITIVITY:g}x')
    print('Pairing token:', TOKEN)
    if not ssl_context:
        print('WARNING: WS only; GitHub Pages HTTPS requires WSS with a trusted certificate.')
    async with websockets.serve(handle, HOST, PORT, ssl=ssl_context, max_size=4096, origins=None):
        await asyncio.Future()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('Stopped')
