# mouse. UI 전용 파일

연결·카메라·PC 서버 구현을 제외한 **UI만** 들어 있습니다. 별도 설치나 빌드 없이 `index.html`을 열 수 있습니다. GitHub에 이 폴더의 파일과 `vendor` 폴더를 그대로 올리세요. 기존 저장소에 `ui` 폴더째 올리면 GitHub Pages의 `/ui/` 경로에서 UI를 따로 확인할 수 있습니다.

## 포함 파일

- `index.html`: 연결 화면, 전체 화면 마우스, 설정, 첫 사용 안내, 도움말
- `style.css`: 레이아웃과 마우스 외형
- `ui.js`: 터치 제스처·UI 상태·연동 이벤트
- `manifest.webmanifest`: 홈 화면 추가용 화면 설정
- `vendor/`: 로컬 Lucide 아이콘과 라이선스

## UI 동작

- 시작 화면: Bluetooth / USB-C 연결 요청 버튼
- 연결 성공을 알려주면 마우스 화면으로 이동
- 화면을 꽉 채운 마우스. 평소에는 글자 없이 전원 버튼만 표시
- 좌클릭 / 우클릭 / 휠 입력
- 좌클릭을 **0.45초 이상 꾹 누르면 드래그 시작**, 손을 떼면 종료
- 몸통 두 번 탭으로 설정 열기, 설정 바깥 두 번 탭으로 닫기
- X / Y 감도와 휠 햅틱 설정. 별도 드래그 스위치 없음
- 첫 연결에서 버튼 안내, 설정의 `? 도움말`에서 사용법과 안내 다시 보기
- 감도·햅틱·첫 안내 완료 상태는 브라우저 저장소에 저장

**화면만 둘러보기**를 누르면 연결 없이 UI를 확인할 수 있습니다. 이 모드에서는 실제 입력 이벤트를 보내지 않습니다.

## 연결 담당 팀원용

UI는 연결 성공을 임의로 가정하지 않습니다. 연결·카메라·마우스 실행·실제 진동은 팀원이 구현하며, 아래 API와 이벤트로 연결합니다. 실제 네트워크 요청이나 카메라 접근 코드는 이 패키지에 없습니다.

### 연결 성공 / 해제 전달

`ui.js` 로드 후 사용할 수 있습니다.

```javascript
// Bluetooth 연결 성공 후 호출
window.MouseUI.setConnection({ connected: true, transport: 'bluetooth' });

// USB-C 연결 성공 후 호출
window.MouseUI.setConnection({ connected: true, transport: 'usb' });

// 연결이 끊어졌거나 사용자가 해제한 경우
window.MouseUI.setConnection({ connected: false, message: '연결이 끊겼어요.' });

// 연결 대기 화면의 상태 문구
window.MouseUI.setConnectionStatus('기기를 찾는 중이에요.');

// 현재 UI 상태 확인
const { connected, demo, transport, enabled, settings, paused } = window.MouseUI.getState();
// settings: { x: 3, y: 6, haptic: true }
```

### 연결 요청 받기

```javascript
window.addEventListener('mouseui:connectrequest', ({ detail }) => {
  // detail.transport: 'bluetooth' 또는 'usb'
  // 여기서 실제 연결을 시작하고, 성공한 뒤 setConnection을 호출하세요.
});

window.addEventListener('mouseui:disconnectrequest', () => {
  // 설정의 뒤로가기로 연결 화면에 돌아올 때 실제 연결을 해제하세요.
});
```

### 입력 받기

```javascript
window.addEventListener('mouseui:input', ({ detail }) => {
  // 팀원이 실제 전송 / OS 실행 함수에 전달합니다.
  // { type: 'click', button: 'left' | 'right' }
  // { type: 'button', button: 'left', action: 'down' | 'up' }
  // { type: 'scroll', dy: -1 }
});
```

드래그는 꾹 누를 때 `button/down`, 손을 뗄 때 `button/up`입니다. 그 사이 카메라 이동을 기존 방식으로 보내면 됩니다. 짧은 탭은 `click` 한 번입니다. `scroll.dy`는 양수면 위, 음수면 아래이며 한 이벤트당 최대 20칸입니다.

OFF·설정·도움말·첫 안내·백그라운드 상태에서는 새 입력을 보내지 않습니다. 이미 누른 버튼은 취소·화면 전환·연결 해제 때 `up`으로 해제합니다. 실제 연결이 끊어진 경우 UI 해제 신호가 도착하지 않을 수 있으므로, PC 수신부도 연결 종료 때 눌린 버튼을 놓도록 처리하세요.

### 감도 · 전원 · 카메라 일시 정지 · 햅틱

```javascript
window.addEventListener('mouseui:settings', ({ detail }) => {
  // { x: 3, y: 6, haptic: true }
  // 기존 카메라 이동량의 X/Y 배율에 적용하세요.
});

window.addEventListener('mouseui:power', ({ detail }) => {
  // { enabled: true | false }
});

window.addEventListener('mouseui:pause', ({ detail }) => {
  // { paused: true | false }
  // true면 이동 추적/전송을 멈추고, false면 재개하세요.
});

window.addEventListener('mouseui:haptic', ({ detail }) => {
  // { kind: 'selection' }
  // 해당 기기에서 지원하는 실제 햅틱 함수를 호출하세요.
});
```

카메라 이동 자체는 UI에서 계산하지 않습니다. 초기 감도는 `MouseUI.getState().settings`로 읽어 적용하세요. 모든 이벤트는 `window`의 `CustomEvent`이며 데이터는 `event.detail`에 있습니다.

추가 UI 함수: `MouseUI.openHelp()`는 도움말을 열고, `MouseUI.preview()`는 연결 없는 화면 미리보기로 전환합니다.

## 확인한 범위

첫 사용 안내·도움말·두 번 탭 설정·감도 저장·꾹 누르기 드래그와 해제·전원 입력 차단·연동 이벤트·세로/가로 레이아웃을 브라우저에서 확인했습니다. 실제 Bluetooth·USB·카메라·Windows 마우스·진동 장치 연결은 포함하지 않습니다.

Lucide ISC 라이선스: `vendor/LICENSE-lucide`.
