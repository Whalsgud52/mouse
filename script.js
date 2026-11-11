
const video = document.getElementById("camera");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

// ========================================
// 1. 개발용 화면 생성
// ========================================

const panel = document.createElement("section");
panel.id = "trackingPanel";

panel.innerHTML = `
  <h3>전면 카메라 이동 추적 (정확도 개선)</h3>

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
  <input id="deadzoneSlider" type="range"
    min="0" max="1" step="0.02" value="0.12">

  <label for="sensitivitySlider">
    감도: <span id="sensitivityValue">3.0</span>배
  </label>
  <input id="sensitivitySlider" type="range"
    min="0.5" max="10" step="0.5" value="3">

  <label for="smoothingSlider">
    스무딩: <span id="smoothingValue">25</span>%
  </label>
  <input id="smoothingSlider" type="range"
    min="0" max="85" step="5" value="25">
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

  #trackingPanel input[type=range] {
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

  #rawMovement, #points, #fpsText {
    font-size: 14px;
    color: #555;
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
// 3. 화면 요소 및 설정 변수
// ========================================

const $ = (id) => document.getElementById(id);

const opencvStatus = $("opencvStatus");
const pointsText = $("points");
const fpsText = $("fpsText");
const rawMovementText = $("rawMovement");
const movementText = $("movement");
const totalMovementText = $("totalMovement");
const virtualArea = $("virtualArea");
const virtualCursor = $("virtualCursor");

let deadzone = 0.12;
let sensitivity = 3;
let smoothing = 0.25;

let smoothDx = 0;
let smoothDy = 0;

let totalX = 0;
let totalY = 0;

let cursorX = 0;
let cursorY = 0;

// ========================================
// 4. 슬라이더 설정
// ========================================

$("deadzoneSlider").addEventListener("input", (e) => {
  deadzone = Number(e.target.value);

  $("deadzoneValue").textContent =
    deadzone.toFixed(2);
});

$("sensitivitySlider").addEventListener("input", (e) => {
  sensitivity = Number(e.target.value);

  $("sensitivityValue").textContent =
    sensitivity.toFixed(1);
});

$("smoothingSlider").addEventListener("input", (e) => {
  smoothing = Number(e.target.value) / 100;

  $("smoothingValue").textContent =
    (smoothing * 100).toFixed(0);
});

// ========================================
// 5. 가상 커서 및 누적 이동량
// ========================================

function drawCursor() {
  const maxX = Math.max(
    0,
    virtualArea.clientWidth - virtualCursor.offsetWidth
  );

  const maxY = Math.max(
    0,
    virtualArea.clientHeight - virtualCursor.offsetHeight
  );

  cursorX = Math.min(maxX, Math.max(0, cursorX));
  cursorY = Math.min(maxY, Math.max(0, cursorY));

  virtualCursor.style.transform =
    `translate(${cursorX}px, ${cursorY}px)`;

  totalMovementText.textContent =
    `누적 X: ${totalX.toFixed(2)} | ` +
    `Y: ${totalY.toFixed(2)}`;
}

function resetCursor() {
  totalX = 0;
  totalY = 0;

  smoothDx = 0;
  smoothDy = 0;

  cursorX =
    (virtualArea.clientWidth -
      virtualCursor.offsetWidth) / 2;

  cursorY =
    (virtualArea.clientHeight -
      virtualCursor.offsetHeight) / 2;

  // 이전 프레임을 초기화하여 오차 방지
  if (previousGray) {
    previousGray.delete();
    previousGray = null;
  }

  rawMovementText.textContent =
    "원본 dx: 0.00 | dy: 0.00";

  movementText.textContent =
    "보정 dx: 0.00 | dy: 0.00";

  drawCursor();
}

$("resetCursor").addEventListener("click", resetCursor);
window.addEventListener("resize", drawCursor);

// ========================================
// 6. OpenCV 초기화
// ========================================

let cvLib = null;
let promiseAttached = false;
let cvPollTimer = null;

function setReady(candidate) {
  if (
    !candidate ||
    typeof candidate.Mat !== "function"
  ) {
    return false;
  }

  cvLib = candidate;

  opencvStatus.textContent = "OpenCV 준비 완료";
  opencvStatus.style.color = "green";

  if (cvPollTimer !== null) {
    clearInterval(cvPollTimer);
    cvPollTimer = null;
  }

  return true;
}

function checkOpenCV() {
  if (cvLib) return;

  const candidate = window.cv;

  if (setReady(candidate)) return;

  if (
    candidate &&
    typeof candidate.then === "function" &&
    !promiseAttached
  ) {
    promiseAttached = true;

    candidate.then((module) => {
      if (!setReady(module)) {
        opencvStatus.textContent =
          "OpenCV 초기화 실패";
      }
    }).catch((error) => {
      opencvStatus.textContent =
        "OpenCV 초기화 오류";

      console.error(error);
    });
  }
}

window.Module = {
  onRuntimeInitialized: checkOpenCV
};

const library = document.createElement("script");

library.src =
  "https://docs.opencv.org/4.x/opencv.js";

library.onload = () => {
  checkOpenCV();

  if (!cvLib) {
    opencvStatus.textContent =
      "OpenCV 초기화 중...";
  }
};

library.onerror = () => {
  opencvStatus.textContent =
    "OpenCV 다운로드 실패";

  opencvStatus.style.color = "red";
};

document.head.appendChild(library);

cvPollTimer = setInterval(checkOpenCV, 200);

setTimeout(() => {
  if (!cvLib) {
    if (cvPollTimer !== null) {
      clearInterval(cvPollTimer);
    }

    opencvStatus.textContent =
      "OpenCV 초기화 지연 또는 실패";

    opencvStatus.style.color = "red";
  }
}, 60000);

// ========================================
// 7. 카메라 및 영상 분석 준비
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
let fpsSamples = [];

// ========================================
// 8. 중앙값 계산
// ========================================

function median(values) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] + sorted[middle]
  ) / 2;
}

// ========================================
// 9. 이상 이동량 제거
// ========================================

function filterVectors(vectors) {
  if (vectors.length < 6) {
    return [];
  }

  // 특징점 이동량의 중앙값 계산
  const centerDx = median(
    vectors.map((v) => v.dx)
  );

  const centerDy = median(
    vectors.map((v) => v.dy)
  );

  // 중앙 이동량과의 거리 계산
  const distances = vectors.map((v) =>
    Math.hypot(
      v.dx - centerDx,
      v.dy - centerDy
    )
  );

  // MAD 기반 이상값 제거
  const mad = median(distances);

  const limit = Math.max(
    1.5,
    3 * 1.4826 * mad
  );

  return vectors.filter((v) =>
    Math.hypot(
      v.dx - centerDx,
      v.dy - centerDy
    ) <= limit
  );
}

// ========================================
// 10. 데드존 / 감도 / 스무딩
// ========================================

function correction(rawDx, rawDy) {
  const dx =
    Math.abs(rawDx) < deadzone ? 0 : rawDx;

  const dy =
    Math.abs(rawDy) < deadzone ? 0 : rawDy;

  // 스무딩
  smoothDx = dx === 0
    ? 0
    : smoothing * smoothDx +
      (1 - smoothing) * dx;

  smoothDy = dy === 0
    ? 0
    : smoothing * smoothDy +
      (1 - smoothing) * dy;

  return {
    dx: smoothDx * sensitivity,
    dy: smoothDy * sensitivity
  };
}

// ========================================
// 11. iPhone 전면 카메라 실행
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

    lastAttempt = 0;
    lastProcessed = 0;
    fpsSamples = [];

    tracking = true;

    requestAnimationFrame(trackMotion);

  } catch (error) {
    statusText.textContent =
      "카메라 실행 실패: " + error.message;

    console.error(error);
  }
}

startBtn.addEventListener("click", startCamera);

// 화면 전환 시 프레임 초기화
document.addEventListener("visibilitychange", () => {
  if (document.hidden && previousGray) {
    previousGray.delete();
    previousGray = null;
  }

  lastAttempt = 0;
  lastProcessed = 0;
  fpsSamples = [];
});

// ========================================
// 12. Optical Flow 정확도 개선
// ========================================

function trackMotion(timestamp) {
  if (!tracking) return;

  requestAnimationFrame(trackMotion);

  // 최대 약 20FPS 분석
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

    if (previousGray) {

      prevPts = new cvLib.Mat();
      nextPts = new cvLib.Mat();
      backPts = new cvLib.Mat();

      forwardStatus = new cvLib.Mat();
      forwardErr = new cvLib.Mat();

      backStatus = new cvLib.Mat();
      backErr = new cvLib.Mat();

      mask = new cvLib.Mat();

      // 특징점 탐색
      cvLib.goodFeaturesToTrack(
        previousGray,
        prevPts,
        120,
        0.01,
        6,
        mask
      );

      const totalFeatures = prevPts.rows;

      let fbPassed = 0;
      let vectors = [];

      if (totalFeatures > 0) {

        const winSize =
          new cvLib.Size(21, 21);

        const criteria =
          new cvLib.TermCriteria(
            cvLib.TermCriteria_COUNT +
            cvLib.TermCriteria_EPS,
            25,
            0.03
          );

        // -----------------------------
        // A. 정방향 Optical Flow
        // 이전 프레임 -> 현재 프레임
        // -----------------------------

        cvLib.calcOpticalFlowPyrLK(
          previousGray,
          gray,
          prevPts,
          nextPts,
          forwardStatus,
          forwardErr,
          winSize,
          3,
          criteria
        );

        // -----------------------------
        // B. 역방향 Optical Flow
        // 현재 프레임 -> 이전 프레임
        // -----------------------------

        cvLib.calcOpticalFlowPyrLK(
          gray,
          previousGray,
          nextPts,
          backPts,
          backStatus,
          backErr,
          winSize,
          3,
          criteria
        );

        // -----------------------------
        // C. Forward-Backward 검증
        // -----------------------------

        for (let i = 0; i < totalFeatures; i++) {

          // 양방향 추적 성공 여부
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

          // 현재 영상 범위를 벗어난 특징점 제외
          if (
            x1 < 0 ||
            x1 >= canvas.width ||
            y1 < 0 ||
            y1 >= canvas.height
          ) {
            continue;
          }

          // 역방향 추적 후 원래 위치와 비교
          const backError =
            Math.hypot(
              xb - x0,
              yb - y0
            );

          // 1.5픽셀보다 큰 오차 제거
          if (backError > 1.5) {
            continue;
          }

          const dx = x1 - x0;
          const dy = y1 - y0;

          // 비정상적으로 큰 순간 이동 제거
          if (Math.hypot(dx, dy) > 35) {
            continue;
          }

          fbPassed++;

          vectors.push({ dx, dy });
        }
      }

      // -----------------------------
      // D. 이상 이동량 필터링
      // -----------------------------

      vectors = filterVectors(vectors);

      pointsText.textContent =
        `특징점: ${totalFeatures} / ` +
        `검증 통과: ${fbPassed} / ` +
        `최종: ${vectors.length}`;

      // -----------------------------
      // E. 이동량 계산
      // -----------------------------

      let rawDx = 0;
      let rawDy = 0;

      // 유효 특징점이 충분할 때만 계산
      if (vectors.length >= 6) {

        rawDx = median(
          vectors.map((v) => v.dx)
        );

        rawDy = -median(
          vectors.map((v) => v.dy)
        );
      }

      // 전면 카메라 방향 보정 유지
      // 오른쪽: dx 양수
      // 왼쪽: dx 음수
      // 위쪽: dy 음수
      // 아래쪽: dy 양수

      const corrected =
        correction(rawDx, rawDy);

      rawMovementText.textContent =
        `원본 dx: ${rawDx.toFixed(2)} | ` +
        `dy: ${rawDy.toFixed(2)}`;

      movementText.textContent =
        `보정 dx: ${corrected.dx.toFixed(2)} | ` +
        `dy: ${corrected.dy.toFixed(2)}`;

      // -----------------------------
      // F. 누적 이동량 및 가상 커서
      // -----------------------------

      totalX += corrected.dx;
      totalY += corrected.dy;

      cursorX += corrected.dx;
      cursorY += corrected.dy;

      drawCursor();
    }

    // -----------------------------
    // G. 이전 프레임 갱신
    // -----------------------------

    if (previousGray) {
      previousGray.delete();
    }

    previousGray = gray;
    gray = null;

    // -----------------------------
    // H. 실제 분석 FPS 계산
    // -----------------------------

    const now = performance.now();

    if (lastProcessed > 0) {
      const dt = now - lastProcessed;

      if (dt > 0) {
        fpsSamples.push(dt);

        if (fpsSamples.length > 10) {
          fpsSamples.shift();
        }

        const averageDt =
          fpsSamples.reduce(
            (a, b) => a + b, 0
          ) / fpsSamples.length;

        fpsText.textContent =
          `실제 분석 FPS: ` +
          `${(1000 / averageDt).toFixed(1)}`;
      }
    }

    lastProcessed = now;

  } catch (error) {

    tracking = false;

    statusText.textContent =
      "영상 분석 오류: " + error.message;

    statusText.style.color = "red";

    console.error(error);

    if (previousGray) {
      previousGray.delete();
      previousGray = null;
    }

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

// 처음 실행 시 가상 커서 초기화
resetCursor();
