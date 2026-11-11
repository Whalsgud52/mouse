
const video = document.getElementById("camera");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

// ========================================
// 1. 화면 및 가상 커서 UI
// ========================================

const panel = document.createElement("section");
panel.id = "trackingPanel";

panel.innerHTML = `
    <h3>전면 카메라 이동 추적</h3>

    <p id="opencvStatus">OpenCV 로딩 중...</p>
    <p id="points">추적 특징점: 0</p>

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

    <h3>마우스 이동 설정</h3>

    <label for="deadzoneSlider">
        데드존:
        <span id="deadzoneValue">0.12</span>
    </label>

    <input id="deadzoneSlider" type="range"
        min="0" max="1" step="0.02" value="0.12">

    <label for="sensitivitySlider">
        마우스 감도:
        <span id="sensitivityValue">3.0</span>배
    </label>

    <input id="sensitivitySlider" type="range"
        min="0.5" max="10" step="0.5" value="3">

    <label for="smoothingSlider">
        스무딩:
        <span id="smoothingValue">25</span>%
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

    #trackingPanel input[type="range"] {
        width: 90%;
        display: block;
        margin: 10px auto 22px;
        accent-color: #2563eb;
    }

    #trackingPanel label {
        display: block;
    }

    #movement {
        font-size: 18px;
        font-weight: bold;
        color: #2563eb;
    }

    #rawMovement, #points {
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
        border-radius: 50%;
        background: #2563eb;
        border: 2px solid white;
        box-sizing: border-box;
        box-shadow: 0 0 0 1px #2563eb;
        pointer-events: none;
    }

    #resetCursor {
        padding: 9px 16px;
        font-size: 14px;
    }
`;

document.head.appendChild(extraStyle);

// ========================================
// 3. 화면 요소 및 변수
// ========================================

const opencvStatus =
    document.getElementById("opencvStatus");

const pointsText =
    document.getElementById("points");

const rawMovementText =
    document.getElementById("rawMovement");

const movementText =
    document.getElementById("movement");

const totalMovementText =
    document.getElementById("totalMovement");

const virtualArea =
    document.getElementById("virtualArea");

const virtualCursor =
    document.getElementById("virtualCursor");

const deadzoneSlider =
    document.getElementById("deadzoneSlider");

const sensitivitySlider =
    document.getElementById("sensitivitySlider");

const smoothingSlider =
    document.getElementById("smoothingSlider");

let deadzone = 0.12;
let sensitivity = 3.0;
let smoothing = 0.25;

let smoothDx = 0;
let smoothDy = 0;

// 누적 이동량
let totalX = 0;
let totalY = 0;

// 가상 커서 위치
let cursorX = 0;
let cursorY = 0;

// ========================================
// 4. 가상 마우스 커서
// ========================================

function drawVirtualCursor() {

    const maxX = Math.max(
        0,
        virtualArea.clientWidth -
        virtualCursor.offsetWidth
    );

    const maxY = Math.max(
        0,
        virtualArea.clientHeight -
        virtualCursor.offsetHeight
    );

    // 커서가 영역을 벗어나지 않도록 제한
    cursorX = Math.max(0, Math.min(maxX, cursorX));
    cursorY = Math.max(0, Math.min(maxY, cursorY));

    virtualCursor.style.transform =
        `translate(${cursorX}px, ${cursorY}px)`;

    totalMovementText.textContent =
        `누적 X: ${totalX.toFixed(2)} | ` +
        `Y: ${totalY.toFixed(2)}`;
}

// 커서를 중앙으로 초기화
function resetVirtualCursor() {

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

    drawVirtualCursor();
}

document.getElementById("resetCursor")
    .addEventListener("click", resetVirtualCursor);

window.addEventListener("resize", drawVirtualCursor);

resetVirtualCursor();

// ========================================
// 5. 감도 / 데드존 / 스무딩 설정
// ========================================

deadzoneSlider.addEventListener("input", () => {

    deadzone = Number(deadzoneSlider.value);

    document.getElementById("deadzoneValue")
        .textContent = deadzone.toFixed(2);
});

sensitivitySlider.addEventListener("input", () => {

    sensitivity = Number(sensitivitySlider.value);

    document.getElementById("sensitivityValue")
        .textContent = sensitivity.toFixed(1);
});

smoothingSlider.addEventListener("input", () => {

    smoothing =
        Number(smoothingSlider.value) / 100;

    document.getElementById("smoothingValue")
        .textContent = Math.round(smoothing * 100);
});

// ========================================
// 6. OpenCV 초기화
// ========================================

let cvLib = null;
let promiseAttached = false;

function markOpenCVReady(module) {

    if (!module || typeof module.Mat !== "function") {
        return false;
    }

    cvLib = module;

    opencvStatus.textContent = "OpenCV 준비 완료";
    opencvStatus.style.color = "green";

    return true;
}

function checkOpenCV() {

    if (cvLib) return;

    const candidate = window.cv;

    if (markOpenCVReady(candidate)) return;

    if (
        candidate &&
        typeof candidate.then === "function" &&
        !promiseAttached
    ) {
        promiseAttached = true;

        candidate.then((module) => {

            if (!markOpenCVReady(module)) {
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

const cvPollTimer = setInterval(() => {

    checkOpenCV();

    if (cvLib) {
        clearInterval(cvPollTimer);
    }

}, 250);

setTimeout(() => {

    if (!cvLib) {

        clearInterval(cvPollTimer);

        opencvStatus.textContent =
            "OpenCV 초기화 지연 또는 실패";

        opencvStatus.style.color = "red";
    }

}, 60000);

// ========================================
// 7. 전면 카메라 실행
// ========================================

const canvas = document.createElement("canvas");

canvas.width = 320;
canvas.height = 240;

const ctx = canvas.getContext("2d", {
    willReadFrequently: true
});

let previousGray = null;
let tracking = false;
let lastTime = 0;

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
            previousGray = null;
        }

        lastTime = 0;
        tracking = true;

        requestAnimationFrame(trackMotion);

    } catch (error) {

        statusText.textContent =
            "카메라 실행 실패: " + error.message;

        console.error(error);
    }
}

startBtn.addEventListener("click", startCamera);

// 브라우저가 백그라운드로 이동하면
// 이전 프레임을 초기화
document.addEventListener("visibilitychange", () => {

    if (document.hidden && previousGray) {
        previousGray.delete();
        previousGray = null;
    }

    lastTime = 0;
});

// ========================================
// 8. 중앙값 계산
// ========================================

function median(values) {

    if (values.length === 0) return 0;

    values.sort((a, b) => a - b);

    const mid = Math.floor(values.length / 2);

    if (values.length % 2) {
        return values[mid];
    }

    return (values[mid - 1] + values[mid]) / 2;
}

// ========================================
// 9. 이동량 보정
// ========================================

function applyMovementCorrection(rawDx, rawDy) {

    // 데드존
    let dx =
        Math.abs(rawDx) < deadzone ? 0 : rawDx;

    let dy =
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

    // 감도 적용
    return {
        dx: smoothDx * sensitivity,
        dy: smoothDy * sensitivity
    };
}

// ========================================
// 10. Optical Flow 이동 추적
// ========================================

function trackMotion(timestamp) {

    if (!tracking) return;

    requestAnimationFrame(trackMotion);

    // 약 10FPS로 분석
    if (
        timestamp - lastTime < 100 ||
        !cvLib ||
        video.readyState < 2
    ) {
        return;
    }

    lastTime = timestamp;

    let src = null;
    let gray = null;

    let prevPts = null;
    let nextPts = null;

    let status = null;
    let err = null;
    let mask = null;

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

            status = new cvLib.Mat();
            err = new cvLib.Mat();
            mask = new cvLib.Mat();

            // 특징점 탐색
            cvLib.goodFeaturesToTrack(
                previousGray,
                prevPts,
                80,
                0.01,
                8,
                mask
            );

            const dxList = [];
            const dyList = [];

            if (prevPts.rows > 0) {

                // Lucas-Kanade Optical Flow
                cvLib.calcOpticalFlowPyrLK(
                    previousGray,
                    gray,
                    prevPts,
                    nextPts,
                    status,
                    err,
                    new cvLib.Size(21, 21),
                    2,
                    new cvLib.TermCriteria(
                        cvLib.TermCriteria_COUNT +
                        cvLib.TermCriteria_EPS,
                        20,
                        0.03
                    )
                );

                // 특징점별 이동량
                for (let i = 0; i < prevPts.rows; i++) {

                    if (status.data[i] !== 1) {
                        continue;
                    }

                    const pointDx =
                        nextPts.data32F[i * 2] -
                        prevPts.data32F[i * 2];

                    const pointDy =
                        nextPts.data32F[i * 2 + 1] -
                        prevPts.data32F[i * 2 + 1];

                    if (
                        Number.isFinite(pointDx) &&
                        Number.isFinite(pointDy)
                    ) {
                        dxList.push(pointDx);
                        dyList.push(pointDy);
                    }
                }
            }

            // 전면 카메라 방향 보정
            const rawDx = median(dxList);
            const rawDy = -median(dyList);

            // 보정된 이동량
            const corrected =
                applyMovementCorrection(rawDx, rawDy);

            rawMovementText.textContent =
                `원본 dx: ${rawDx.toFixed(2)} | ` +
                `dy: ${rawDy.toFixed(2)}`;

            movementText.textContent =
                `보정 dx: ${corrected.dx.toFixed(2)} | ` +
                `dy: ${corrected.dy.toFixed(2)}`;

            pointsText.textContent =
                `추적 특징점: ${dxList.length}`;

            // ==================================
            // 11. 누적 이동량 계산
            // ==================================

            totalX += corrected.dx;
            totalY += corrected.dy;

            // 가상 커서 이동
            cursorX += corrected.dx;
            cursorY += corrected.dy;

            drawVirtualCursor();
        }

        if (previousGray) {
            previousGray.delete();
        }

        previousGray = gray;
        gray = null;

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

        if (src) src.delete();
        if (gray) gray.delete();

        if (prevPts) prevPts.delete();
        if (nextPts) nextPts.delete();

        if (status) status.delete();
        if (err) err.delete();
        if (mask) mask.delete();
    }
}
