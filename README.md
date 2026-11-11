# iPhone Mouse — 팀원 C Windows 수신 서버

## 실행 (Windows PowerShell)

```powershell
cd iphone_mouse_c
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

콘솔에 표시되는 **Pairing token**은 다른 사람에게 공개하지 마세요. 종료는 Ctrl+C입니다.

## 연결 규약

클라이언트가 WebSocket을 열면 가장 먼저 다음 JSON을 전송합니다.

```json
{"type":"pair","token":"서버 콘솔의 토큰"}
```

서버가 인증에 성공하면 아래 응답을 보냅니다.

```json
{"type":"paired","ok":true}
```

이후 기존 A 코드의 이동 메시지를 그대로 받습니다.

```json
{"type":"move","dx":2.35,"dy":-1.42,"timestamp":1794376800000}
```

`dx`, `dy`는 픽셀 단위 상대 이동으로 해석하며 소수점 잔여값을 누적합니다. 비정상적 값과 과도한 이동량은 무시합니다. 마우스 제어는 인증된 연결에서만 수행합니다. 마우스 제어를 즉시 중지하려면 서버 콘솔에서 Ctrl+C를 누르세요.

## GitHub Pages에서 연결하기

HTTPS 페이지는 보안 WebSocket `wss://`가 필요합니다. 로컬 `ws://192.168.x.x:8765`를 GitHub Pages 페이지에 넣어서는 정상 연결을 기대할 수 없습니다. 이 서버는 TLS 인증서 경로를 환경 변수로 지정하면 WSS로 실행됩니다.

```powershell
$env:MOUSE_TLS_CERT='C:\\path\\fullchain.pem'
$env:MOUSE_TLS_KEY='C:\\path\\privkey.pem'
.\.venv\Scripts\python.exe server.py
```

iPhone Safari가 신뢰하는 인증서, 인증서와 일치하는 DNS 호스트명, 네트워크 접근 경로가 필요합니다. 사설 IP에 공인 도메인 인증서를 단순 연결하는 것만으로 해결되지 않습니다. 외부 공개를 피하려면 적절한 로컬 HTTPS/WSS 개발 환경이나 인증된 터널을 별도로 구성해야 합니다. 터널을 사용하는 경우 외부에 입력 제어 서버가 노출될 수 있으므로 접근 제어와 토큰 보호가 필수입니다.

## A 코드 변경

`script.js`의 `const PC_SERVER_URL = "";`에 실제 **WSS 주소**를 넣고, `pcSocket.onopen`에서 아래 메시지를 전송하도록 A에게 요청하세요.

```javascript
pcSocket.onopen = () => {
  pcSocket.send(JSON.stringify({ type: 'pair', token: PAIR_TOKEN }));
};
```

`PAIR_TOKEN`은 사용자 입력 UI로 받도록 하세요. **GitHub Pages의 공개 소스 코드에 토큰을 하드코딩하면 안 됩니다.** A의 기존 `paired` 응답 처리와 `sendMouseMove` 함수는 그대로 사용할 수 있습니다.

## 제약

- 현재 버전은 이동만 처리합니다. 클릭/스크롤/드래그는 B의 메시지 형식을 확정한 후 추가하세요.
- 전면 카메라 기반 이동 방향 및 감도는 A가 검증해야 합니다.
- 이 서버는 Windows 데스크톱 세션에서 실행해야 합니다.
- `origins=None`은 Origin 검사에 의존하지 않는 설정입니다. 토큰이 필수이지만, 실제 배포 시에는 허용 Origin을 제한하는 것을 권장합니다.
