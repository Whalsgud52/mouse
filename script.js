
const video = document.getElementById("camera");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");
const $ = (id) => document.getElementById(id);

// ========================================
// 1. 개발용 화면
// ========================================

const panel = document.createElement("section");
panel.id = "trackingPanel";

panel.innerHTML = `
  <h3>전면 카메라 이동 추적</h3>

  <p id="opencvStatus">OpenCV 로딩 중...</p>
  <p id="points">
    특징점: 0 / 검증 통과: 0 / 최종: 0
  </p>
  <p id="fpsText">실제 분석 FPS: 0</p>

  <p id="rawMovement">
    원본 dx: 0.00 | dy: 0.00
  </p>
  <p id="movement">
    보정 dx: 0.00 | dy: 0.00
  </p>

  <hr>

  <h3>기울기 오작동 방지</h3>

  <button id="enableMotion" type="button">
    기울기 센서 활성화
  </button>

  <p id="motionStatus">
    센서 사용 전 (회전 보정 꺼짐)
  </p>

  <p id="rotationValue">회전 속도: --</p>

  <p id="guardStatus">
    커서 이동: 정상 (회전 감지 비활성)
  </p>

  <label for="rotationSlider">
    회전 차단 기준:
    <span id="rotationSetting">10</span> °/초
  </label>

  <input
    id="rotationSlider"
    type="range"
    min="2"
    max="30"
    step="1"
    value="10"
  >

  <hr>

  <h3>가상 마우스 커서</h3>

  <div id="virtualArea">
    <div id="virtualCursor"></div>
  </div>

  <p id="totalMovement">
    누적 X: 0.00 | Y: 0.00
  </p>

  <button id="resetCursor" type="button">
    가상 커서 초기화
  </button>

  <hr>

  <h3>이동 보정 설정</h3>

  <label for="deadzoneSlider">
    데드존: <span id="deadzoneValue">0.12</span>
  </label>

  <input
    id="deadzoneSlider"
    type="range"
    min="0"
    max="1"
    step="0.02"
    value="0.12"
  >

  <label for="sensitivitySlider">
    감도: <span id="sensitivityValue">3.0</span>배
  </label>

  <input
    id="sensitivitySlider"
    type="range"
    min="0.5"
    max="10"
    step="0.5"
    value="3"
  >

  <label for="smoothingSlider">
    스무딩: <span id="smoothingValue">25</span>%
  </label>

  <input
    id="smoothingSlider"
    type="range"
    min="0"
    max="85"
    step="5"
    value="25"
  >
`;

video.before(panel);

// ========================================
// 2. 화면 스타일
// ========================================

const extraStyle = document.createElement("style");

extraStyle.textContent = `
  #trackingPanel {
    max-width: 480px;
    margin: 0 auto 20px;
  }

  #trackingPanel label {
    display: block;
    margin-top: 14px;
  }

  #trackingPanel input[type="range"] {
    display: block;
    width: 90%;
    margin: 10px auto 20px;
    accent-color: #2563eb;
  }

  #movement {
    font-size: 18px;
    font-weight: bold;
    color: #2563eb;
  }

  #rawMovement,
  #points,
  #fpsText,
  #rotationValue {
    font-size: 14px;
    color: #555;
  }

  #motionStatus,
  #guardStatus {
    font-size: 14px;
    font-weight: bold;
  }

  #virtualArea {
    position: relative;
    width: 90%;
    max-width: 360px;
    height: 220px;
    margin: 12px auto;
    border: 2px solid #cbd5e1;
    border-radius: 12px;
    background: #eff6ff;
    overflow: hidden;
  }

  #virtualCursor {
    position: absolute;
    left: 0;
    top: 0;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 2px solid white;
    border-radius: 50%;
    background: #2563eb;
    box-shadow: 0 0 0 1px #2563eb;
    pointer-events: none;
  }
`;

document.head.appendChild(extraStyle);

// ========================================
// 3. 설정값과 가상 커서
// ========================================

let deadzone = 0.12;
let sensitivity = 3;
let smoothing = 0.25;

let smoothDx = 0;
let smoothDy = 0;

let totalX = 0;
let totalY = 0;

let cursorX = 0;
let cursorY = 0;

function drawCursor() {
  const area = $("virtualArea");
  const dot = $("virtualCursor");

  const maxX = Math.max(
    0,
    area.clientWidth - dot.offsetWidth
  );

  const maxY = Math.max(
    0,
    area.clientHeight - dot.offsetHeight
  );

  cursorX = Math.max(0, Math.min(maxX, cursorX));
  cursorY = Math.max(0, Math.min(maxY, cursorY));

  dot.style.transform =
    `translate(${cursorX}px, ${cursorY}px)`;

  $("totalMovement").textContent =
    `누적 X: ${totalX.toFixed(2)} | ` +
    `Y: ${totalY.toFixed(2)}`;
}

function resetCursor() {
  totalX = 0;
  totalY = 0;

  smoothDx = 0;
  smoothDy = 0;

  cursorX =
    ($("virtualArea").clientWidth -
      $("virtualCursor").offsetWidth) / 2;

  cursorY =
    ($("virtualArea").clientHeight -
      $("virtualCursor").offsetHeight) / 2;

  if (previousGray) {
    previousGray.delete();
    previousGray = null;
  }

  $("rawMovement").textContent =
    "원본 dx: 0.00 | dy: 0.00";

  $("movement").textContent =
    "보정 dx: 0.00 | dy: 0.00";

  drawCursor();
}

$("resetCursor").addEventListener(
  "click",
  resetCursor
);

window.addEventListener("resize", drawCursor);

// ========================================
// 4. 기존 감도 보정 설정
// ========================================

$("deadzoneSlider").addEventListener(
  "input",
  (e) => {
    deadzone = Number(e.target.value);

    $("deadzoneValue").textContent =
      deadzone.toFixed(2);
  }
);

$("sensitivitySlider").addEventListener(
  "input",
  (e) => {
    sensitivity = Number(e.target.value);

    $("sensitivityValue").textContent =
      sensitivity.toFixed(1);
  }
);

$("smoothingSlider").addEventListener(
  "input",
  (e) => {
    smoothing = Number(e.target.value) / 100;

    $("smoothingValue").textContent =
      String(Math.round(smoothing * 100));
  }
);

// ========================================
// 5. 자이로스코프 기반 회전 감지
// ========================================

let motionEnabled = false;
let motionReceived = false;

let lastMotionAt = -Infinity;
let rotationSpeed = 0;

// 회전 차단 기준
let rotationThreshold = 10;

// 회전 이후 250ms 동안 추가 차단
let blockUntil = 0;
const BLOCK_HOLD_MS = 250;

// 회전 기준값 슬라이더
$("rotationSlider").addEventListener(
  "input",
  (e) => {
    rotationThreshold = Number(e.target.value);

    $("rotationSetting").textContent =
      String(rotationThreshold);
  }
);

// 자이로스코프 센서 데이터 수신
function onDeviceMotion(event) {
  const r = event.rotationRate;

  if (!r) return;

  const values = [
    r.alpha,
    r.beta,
    r.gamma
  ].filter(Number.isFinite);

  if (values.length === 0) return;

  motionReceived = true;

  lastMotionAt = performance.now();

  rotationSpeed = Math.hypot(...values);

  // 일정 속도 이상 회전하면 커서 차단
  if (rotationSpeed >= rotationThreshold) {
    blockUntil =
      lastMotionAt + BLOCK_HOLD_MS;
  }
}

// ========================================
// 6. 센서 권한 요청
// ========================================

$("enableMotion").addEventListener(
  "click",
  async () => {
    const button = $("enableMotion");

    if (motionEnabled) return;

    if (
      typeof window.DeviceMotionEvent ===
      "undefined"
    ) {
      $("motionStatus").textContent =
        "동작 센서 API를 지원하지 않음";

      return;
    }

    button.disabled = true;

    try {
      // iPhone Safari 센서 권한 요청
      if (
        typeof DeviceMotionEvent.requestPermission ===
        "function"
      ) {
        const permission =
          await DeviceMotionEvent.requestPermission();

        if (permission !== "granted") {
          $("motionStatus").textContent =
            "센서 권한 거부됨";

          button.disabled = false;
          return;
        }
      }

      window.addEventListener(
        "devicemotion",
        onDeviceMotion
      );

      motionEnabled = true;

      button.textContent =
        "기울기 센서 활성화됨";

      $("motionStatus").textContent =
        "센서 연결됨, 회전 데이터 수신 대기...";

    } catch (error) {
      $("motionStatus").textContent =
        `센서 시작 실패: ${error.message}`;

      button.disabled = false;

      console.error(error);
    }
  }
);

// ========================================
// 7. 회전 차단 상태 계산
// ========================================

function rotationBlocked() {
  const fresh =
    performance.now() - lastMotionAt < 1000;

  return (
    motionEnabled &&
    motionReceived &&
    fresh &&
    performance.now() < blockUntil
  );
}

// 상태 표시
function updateRotationUI(blocked) {
  if (!motionEnabled) {
    $("guardStatus").textContent =
      "커서 이동: 정상 (회전 감지 비활성)";

    return;
  }

  if (
    !motionReceived ||
    performance.now() - lastMotionAt >= 1000
  ) {
    $("motionStatus").textContent =
      "센서 데이터 수신 대기 / 중단";

    $("rotationValue").textContent =
      "회전 속도: --";

    $("guardStatus").textContent =
      "커서 이동: 정상 (센서 보호 미적용)";

    return;
  }

  $("motionStatus").textContent =
    "기울기 센서 정상 수신 중";

  $("rotationValue").textContent =
    `회전 속도: ${rotationSpeed.toFixed(1)} °/초`;

  $("guardStatus").textContent = blocked
    ? "회전 감지! 커서 이동 일시 차단"
    : "커서 이동: 정상";

  $("guardStatus").style.color = blocked
    ? "#dc2626"
    : "#15803d";
}

// ========================================
// 8. Windows PC 전송 준비
// ========================================

// 팀원 C의 서버가 준비되면 주소 입력
const PC_SERVER_URL = "";

let pcSocket = null;
let pcPaired = false;

function connectPC() {
  if (!PC_SERVER_URL) return;

  pcSocket = new WebSocket(PC_SERVER_URL);

  pcSocket.onopen = () => {
    console.log("PC 연결됨. 인증 확인 대기");
  };

  pcSocket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (
        msg.type === "paired" &&
        msg.ok === true
      ) {
        pcPaired = true;
      }

    } catch (error) {
      console.error(error);
    }
  };

  pcSocket.onclose = () => {
    pcPaired = false;
  };

  pcSocket.onerror = (error) => {
    console.error("PC 연결 오류", error);
  };
}

// 이동 데이터 전송
function sendMouseMove(dx, dy) {
  if (
    !pcSocket ||
    pcSocket.readyState !== WebSocket.OPEN ||
    !pcPaired
  ) {
    return;
  }

  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy)
  ) {
    return;
  }

  if (dx === 0 && dy === 0) return;

  pcSocket.send(
    JSON.stringify({
      type: "move",
      dx,
      dy,
      timestamp: Date.now()
    })
  );
}

connectPC();

// ========================================
// 9. OpenCV.js 초기화
// ========================================

let cvLib = null;
let promiseAttached = false;
let cvPollTimer = null;

function setOpenCVReady(candidate) {
  if (
    !candidate ||
    typeof candidate.Mat !== "function"
  ) {
    return false;
  }

  cvLib = candidate;

  $("opencvStatus").textContent =
    "OpenCV 준비 완료";

  $("opencvStatus").style.color = "green";

  if (cvPollTimer !== null) {
    clearInterval(cvPollTimer);
    cvPollTimer = null;
  }

  return true;
}

function checkOpenCV() {
  if (cvLib) return;

  const candidate = window.cv;

  if (setOpenCVReady(candidate)) return;

  if (
    candidate &&
    typeof candidate.then === "function" &&
    !promiseAttached
  ) {
    promiseAttached = true;

    candidate.then((module) => {
      if (!setOpenCVReady(module)) {
        $("opencvStatus").textContent =
          "OpenCV 초기화 실패";
      }

    }).catch((error) => {
      $("opencvStatus").textContent =
        "OpenCV 초기화 오류";

      console.error(error);
    });
  }
}

window.Module = {
  onRuntimeInitialized: checkOpenCV
};

const library =
  document.createElement("script");

library.src =
  "https://docs.opencv.org/4.x/opencv.js";

library.onload = () => {
  checkOpenCV();

  if (!cvLib) {
    $("opencvStatus").textContent =
      "OpenCV 초기화 중...";
  }
};

library.onerror = () => {
  $("opencvStatus").textContent =
    "OpenCV 다운로드 실패";

  $("opencvStatus").style.color = "red";
};

document.head.appendChild(library);

cvPollTimer = setInterval(
  checkOpenCV,
  200
);

setTimeout(() => {
  if (!cvLib) {
    clearInterval(cvPollTimer);

    $("opencvStatus").textContent =
      "OpenCV 초기화 지연 또는 실패";

    $("opencvStatus").style.color = "red";
  }
}, 60000);

// ========================================
// 10. 전면 카메라 설정
// ========================================

const canvas = document.createElement("canvas");

canvas.width = 320;
canvas.height = 240;

const ctx = canvas.getContext("2d", {
  willReadFrequently: true
});

let previousGray = null;
let tracking = false;

let lastAttempt = 0;
let lastProcessed = 0;

const fpsSamples = [];

// ========================================
// 11. 중앙값 계산
// ========================================

function median(values) {
  if (!values.length) return 0;

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const m = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[m]
    : (sorted[m - 1] + sorted[m]) / 2;
}

// ========================================
// 12. 이상값 필터링
// ========================================

function filterVectors(vectors) {
  if (vectors.length < 6) return [];

  const cx = median(
    vectors.map((v) => v.dx)
  );

  const cy = median(
    vectors.map((v) => v.dy)
  );

  const distances = vectors.map((v) =>
    Math.hypot(
      v.dx - cx,
      v.dy - cy
    )
  );

  const mad = median(distances);

  const limit = Math.max(
    1.5,
    3 * 1.4826 * mad
  );

  return vectors.filter((v) =>
    Math.hypot(
      v.dx - cx,
      v.dy - cy
    ) <= limit
  );
}

// ========================================
// 13. 데드존 / 스무딩 / 감도
// ========================================

function correction(rawDx, rawDy, blocked) {

  // 기울기 감지 시 커서 이동 차단
  if (blocked) {
    smoothDx = 0;
    smoothDy = 0;

    return {
      dx: 0,
      dy: 0
    };
  }

  // 데드존 적용
  const dx =
    Math.abs(rawDx) < deadzone
      ? 0
      : rawDx;

  const dy =
    Math.abs(rawDy) < deadzone
      ? 0
      : rawDy;

  // 스무딩 적용
  smoothDx = dx === 0
    ? 0
    : smoothing * smoothDx +
      (1 - smoothing) * dx;

  smoothDy = dy === 0
    ? 0
    : smoothing * smoothDy +
      (1 - smoothing) * dy;

  // 감도 적용
  return {
    dx: smoothDx * sensitivity,
    dy: smoothDy * sensitivity
  };
}

// ========================================
// 14. iPhone 전면 카메라 시작
// ========================================

async function startCamera() {
  try {
    statusText.textContent =
      "카메라 연결 중...";

    const stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: "user" },

          width: { ideal: 640 },
          height: { ideal: 480 }
        },

        audio: false
      });

    video.srcObject = stream;

    await video.play();

    statusText.textContent =
      "전면 카메라 실행 중";

    statusText.style.color = "green";

    startBtn.disabled = true;

    if (previousGray) {
      previousGray.delete();
    }

    previousGray = null;

    lastAttempt = 0;
    lastProcessed = 0;

    fpsSamples.length = 0;

    tracking = true;

    requestAnimationFrame(trackMotion);

  } catch (error) {
    statusText.textContent =
      `카메라 실행 실패: ${error.message}`;

    console.error(error);
  }
}

startBtn.addEventListener(
  "click",
  startCamera
);

// 화면 전환 시 초기화
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden && previousGray) {
      previousGray.delete();
      previousGray = null;
    }

    lastAttempt = 0;
    lastProcessed = 0;

    fpsSamples.length = 0;

    blockUntil = 0;
  }
);

// ========================================
// 15. Optical Flow 분석
// ========================================

function trackMotion(timestamp) {
  if (!tracking) return;

  requestAnimationFrame(trackMotion);

  // 최대 약 20FPS
  if (
    timestamp - lastAttempt < 50 ||
    !cvLib ||
    video.readyState < 2
  ) {
    return;
  }

  lastAttempt = timestamp;

  let src = null;
  let gray = null;
  let mask = null;

  let prevPts = null;
  let nextPts = null;
  let backPts = null;

  let forwardStatus = null;
  let forwardErr = null;

  let backStatus = null;
  let backErr = null;

  try {
    ctx.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    src = cvLib.imread(canvas);

    gray = new cvLib.Mat();

    cvLib.cvtColor(
      src,
      gray,
      cvLib.COLOR_RGBA2GRAY
    );

    // 기울기 감지 확인
    const blocked = rotationBlocked();

    updateRotationUI(blocked);

    if (previousGray) {
      let totalFeatures = 0;
      let fbPassed = 0;

      let vectors = [];

      // 회전 중에는 Optical Flow 이동 추적 차단
      if (!blocked) {
        prevPts = new cvLib.Mat();
        nextPts = new cvLib.Mat();
        backPts = new cvLib.Mat();

        forwardStatus = new cvLib.Mat();
        forwardErr = new cvLib.Mat();

        backStatus = new cvLib.Mat();
        backErr = new cvLib.Mat();

        mask = new cvLib.Mat();

        cvLib.goodFeaturesToTrack(
          previousGray,
          prevPts,
          120,
          0.01,
          6,
          mask
        );

        totalFeatures = prevPts.rows;

        if (totalFeatures > 0) {

          const win =
            new cvLib.Size(21, 21);

          const term =
            new cvLib.TermCriteria(
              cvLib.TermCriteria_COUNT +
              cvLib.TermCriteria_EPS,
              25,
              0.03
            );

          // 정방향 Optical Flow
          cvLib.calcOpticalFlowPyrLK(
            previousGray,
            gray,
            prevPts,
            nextPts,
            forwardStatus,
            forwardErr,
            win,
            3,
            term
          );

          // 역방향 Optical Flow
          cvLib.calcOpticalFlowPyrLK(
            gray,
            previousGray,
            nextPts,
            backPts,
            backStatus,
            backErr,
            win,
            3,
            term
          );

          // Forward-Backward 검증
          for (
            let i = 0;
            i < totalFeatures;
            i++
          ) {
            if (
              forwardStatus.data[i] !== 1 ||
              backStatus.data[i] !== 1
            ) {
              continue;
            }

            const x0 =
              prevPts.data32F[2 * i];

            const y0 =
              prevPts.data32F[2 * i + 1];

            const x1 =
              nextPts.data32F[2 * i];

            const y1 =
              nextPts.data32F[2 * i + 1];

            const xb =
              backPts.data32F[2 * i];

            const yb =
              backPts.data32F[2 * i + 1];

            if (
              ![x0, y0, x1, y1, xb, yb]
                .every(Number.isFinite)
            ) {
              continue;
            }

            if (
              x1 < 0 ||
              x1 >= canvas.width ||
              y1 < 0 ||
              y1 >= canvas.height
            ) {
              continue;
            }

            const backError =
              Math.hypot(
                xb - x0,
                yb - y0
              );

            if (backError > 1.5) {
              continue;
            }

            const dx = x1 - x0;
            const dy = y1 - y0;

            if (Math.hypot(dx, dy) > 35) {
              continue;
            }

            fbPassed++;

            vectors.push({ dx, dy });
          }
        }

        vectors = filterVectors(vectors);
      }

      // ==================================
      // 16. 이동량 계산 및 회전 보정
      // ==================================

      $("points").textContent = blocked
        ? "회전 중: 특징점 추적 일시 차단"
        : `특징점: ${totalFeatures} / ` +
          `검증 통과: ${fbPassed} / ` +
          `최종: ${vectors.length}`;

      // 전면 카메라 방향 유지
      const rawDx = vectors.length >= 6
        ? median(vectors.map((v) => v.dx))
        : 0;

      const rawDy = vectors.length >= 6
        ? -median(vectors.map((v) => v.dy))
        : 0;

      // 회전 보정 포함
      const corrected =
        correction(rawDx, rawDy, blocked);

      $("rawMovement").textContent =
        `원본 dx: ${rawDx.toFixed(2)} | ` +
        `dy: ${rawDy.toFixed(2)}`;

      $("movement").textContent =
        `보정 dx: ${corrected.dx.toFixed(2)} | ` +
        `dy: ${corrected.dy.toFixed(2)}`;

      // 누적 이동량
      totalX += corrected.dx;
      totalY += corrected.dy;

      // 가상 커서 이동
      cursorX += corrected.dx;
      cursorY += corrected.dy;

      drawCursor();

      // Windows PC 전송
      sendMouseMove(
        corrected.dx,
        corrected.dy
      );
    }

    // 이전 프레임 갱신
    if (previousGray) {
      previousGray.delete();
    }

    previousGray = gray;
    gray = null;

    // ==================================
    // 17. FPS 계산
    // ==================================

    const now = performance.now();

    if (lastProcessed > 0) {
      const dt = now - lastProcessed;

      if (dt > 0) {
        fpsSamples.push(dt);

        if (fpsSamples.length > 10) {
          fpsSamples.shift();
        }

        const avg =
          fpsSamples.reduce(
            (a, b) => a + b,
            0
          ) / fpsSamples.length;

        $("fpsText").textContent =
          `실제 분석 FPS: ` +
          `${(1000 / avg).toFixed(1)}`;
      }
    }

    lastProcessed = now;

  } catch (error) {
    tracking = false;

    statusText.textContent =
      `영상 분석 오류: ${error.message}`;

    statusText.style.color = "red";

    console.error(error);

    if (previousGray) {
      previousGray.delete();
    }

    previousGray = null;

  } finally {
    // OpenCV 메모리 해제
    for (const mat of [
      src,
      gray,
      mask,
      prevPts,
      nextPts,
      backPts,
      forwardStatus,
      forwardErr,
      backStatus,
      backErr
    ]) {
      if (mat) {
        mat.delete();
      }
    }
  }
}

// 초기 커서 위치 설정
resetCursor();
