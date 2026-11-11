
const video = document.getElementById("camera");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

// ========================================
// 1. 이동량 표시 및 설정 UI
// ========================================

const panel = document.createElement("div");

panel.innerHTML = `
    <h3>카메라 이동량</h3>

    <p id="rawMovement">
        원본 dx: 0.00 | dy: 0.00
    </p>

    <p id="movement">
        보정 dx: 0.00 | dy: 0.00
    </p>

    <p id="points">추적 특징점: 0</p>
    <p id="opencvStatus">OpenCV 로딩 중...</p>

    <hr>

    <h3>마우스 이동 설정</h3>

    <label for="deadzoneSlider">
        데드존: <span id="deadzoneValue">0.12</span>
    </label>
    <input
        type="range"
        id="deadzoneSlider"
        min="0"
        max="1"
        step="0.02"
        value="0.12"
    >

    <br><br>

    <label for="sensitivitySlider">
        마우스 감도:
        <span id="sensitivityValue">3.0</span>배
    </label>
    <input
        type="range"
        id="sensitivitySlider"
        min="0.5"
        max="10"
        step="0.5"
        value="3"
    >

    <br><br>

    <label for="smoothingSlider">
        스무딩:
        <span id="smoothingValue">25</span>%
    </label>
    <input
        type="range"
        id="smoothingSlider"
        min="0"
        max="85"
        step="5"
        value="25"
    >

    <hr>
`;

video.before(panel);

// 설정 UI 스타일
const style = document.createElement("style");

style.textContent = `
    #deadzoneSlider,
    #sensitivitySlider,
    #smoothingSlider {
        width: 90%;
        max-width: 350px;
        display: block;
        margin: 12px auto;
        accent-color: #2563eb;
    }

    #movement {
        font-size: 20px;
        font-weight: bold;
        color: #2563eb;
    }

    #rawMovement {
        font-size: 15px;
        color: #555;
    }

    #opencvStatus {
        font-weight: bold;
    }

    #points {
        font-size: 14px;
    }
`;

document.head.appendChild(style);

// 화면 요소
const rawMovementText =
    document.getElementById("rawMovement");

const movementText =
    document.getElementById("movement");

const pointsText =
    document.getElementById("points");

const opencvStatus =
    document.getElementById("opencvStatus");

// 슬라이더
const deadzoneSlider =
    document.getElementById("deadzoneSlider");

const sensitivitySlider =
    document.getElementById("sensitivitySlider");

const smoothingSlider =
    document.getElementById("smoothingSlider");

// 설정값
let deadzone = 0.12;
let sensitivity = 3.0;
let smoothing = 0.25;

// 스무딩에 사용할 이전 이동량
let smoothDx = 0;
let smoothDy = 0;

// ========================================
// 2. 슬라이더 이벤트
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
    const value = Number(smoothingSlider.value);

    smoothing = value / 100;

    document.getElementById("smoothingValue")
        .textContent = value;
});

// ========================================
// 3. 영상 분석 준비
// ========================================

const canvas = document.createElement("canvas");

canvas.width = 320;
canvas.height = 240;

const ctx = canvas.getContext("2d", {
    willReadFrequently: true
});

let cvLib = null;
let previousGray = null;
let tracking = false;
let lastTime = 0;

let promiseAttached = false;
let cvPollTimer = null;

// ========================================
// 4. OpenCV 초기화
// ========================================

function setOpenCVReady(module) {
    if (!module || typeof module.Mat !== "function") {
        return false;
    }

    if (cvLib) return true;

    cvLib = module;

    opencvStatus.textContent = "OpenCV 준비 완료";
    opencvStatus.style.color = "green";

    if (cvPollTimer !== null) {
        clearInterval(cvPollTimer);
        cvPollTimer = null;
    }

    console.log("OpenCV 초기화 성공");

    return true;
}

function checkOpenCV() {
    if (cvLib) return;

    const candidate = window.cv;

    if (setOpenCVReady(candidate)) {
        return;
    }

    // Promise 방식 지원
    if (
        candidate &&
        typeof candidate.then === "function" &&
        !promiseAttached
    ) {
        promiseAttached = true;

        candidate.then((module) => {
            if (!setOpenCVReady(module)) {
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

// 일부 OpenCV.js 버전에서 사용하는 초기화 콜백
window.Module = {
    onRuntimeInitialized: function () {
        checkOpenCV();
    }
};

// OpenCV 라이브러리 불러오기
const library = document.createElement("script");

library.src = "https://docs.opencv.org/4.x/opencv.js";

library.onload = function () {
    checkOpenCV();

    if (!cvLib) {
        opencvStatus.textContent =
            "OpenCV 초기화 중...";
    }
};

library.onerror = function () {
    opencvStatus.textContent =
        "OpenCV 다운로드 실패";

    opencvStatus.style.color = "red";
};

document.head.appendChild(library);

// 초기화 상태 확인
cvPollTimer = setInterval(() => {
    checkOpenCV();
}, 200);

// 60초 이상 초기화되지 않을 경우 오류 표시
setTimeout(() => {
    if (!cvLib) {
        if (cvPollTimer !== null) {
            clearInterval(cvPollTimer);
            cvPollTimer = null;
        }

        opencvStatus.textContent =
            "OpenCV 초기화 지연 또는 실패";

        opencvStatus.style.color = "red";
    }
}, 60000);

// ========================================
// 5. 전면 카메라 실행
// ========================================

async function startCamera() {
    try {
        statusText.textContent =
            "카메라 연결 중...";

        const stream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    // 전면 카메라 사용
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

        // 이전 데이터 초기화
        if (previousGray !== null) {
            previousGray.delete();
            previousGray = null;
        }

        smoothDx = 0;
        smoothDy = 0;
        lastTime = 0;

        tracking = true;

        requestAnimationFrame(trackMotion);

    } catch (error) {
        statusText.textContent =
            "카메라 실행 실패: " + error.message;

        console.error(error);
    }
}

// ========================================
// 6. 중앙값 계산
// ========================================

function median(values) {
    if (values.length === 0) {
        return 0;
    }

    values.sort((a, b) => a - b);

    const mid = Math.floor(values.length / 2);

    if (values.length % 2 === 1) {
        return values[mid];
    }

    return (values[mid - 1] + values[mid]) / 2;
}

// ========================================
// 7. 데드존 + 감도 + 스무딩
// ========================================

function applyMovementCorrection(rawDx, rawDy) {

    // 1. 데드존 적용
    let dx = rawDx;
    let dy = rawDy;

    if (Math.abs(dx) < deadzone) {
        dx = 0;
    }

    if (Math.abs(dy) < deadzone) {
        dy = 0;
    }

    // 2. 스무딩 적용
    // 0% = 즉시 반영
    // 높은 값 = 이전 이동량을 더 많이 반영

    if (dx === 0) {
        smoothDx = 0;
    } else {
        smoothDx =
            smoothing * smoothDx +
            (1 - smoothing) * dx;
    }

    if (dy === 0) {
        smoothDy = 0;
    } else {
        smoothDy =
            smoothing * smoothDy +
            (1 - smoothing) * dy;
    }

    // 3. 마우스 감도 적용
    const finalDx = smoothDx * sensitivity;
    const finalDy = smoothDy * sensitivity;

    return {
        dx: finalDx,
        dy: finalDy
    };
}

// ========================================
// 8. Optical Flow 이동 추적
// ========================================

function trackMotion(timestamp) {
    if (!tracking) return;

    requestAnimationFrame(trackMotion);

    // 약 10FPS로 분석
    if (timestamp - lastTime < 100) {
        return;
    }

    if (!cvLib || video.readyState < 2) {
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
        // 카메라 영상 캔버스에 복사
        ctx.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        src = cvLib.imread(canvas);

        gray = new cvLib.Mat();

        // 흑백 변환
        cvLib.cvtColor(
            src,
            gray,
            cvLib.COLOR_RGBA2GRAY
        );

        if (previousGray !== null) {
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

                // 특징점별 이동량 계산
                for (let i = 0; i < prevPts.rows; i++) {

                    if (status.data[i] !== 1) {
                        continue;
                    }

                    const x0 =
                        prevPts.data32F[i * 2];

                    const y0 =
                        prevPts.data32F[i * 2 + 1];

                    const x1 =
                        nextPts.data32F[i * 2];

                    const y1 =
                        nextPts.data32F[i * 2 + 1];

                    const pointDx = x1 - x0;
                    const pointDy = y1 - y0;

                    if (
                        Number.isFinite(pointDx) &&
                        Number.isFinite(pointDy)
                    ) {
                        dxList.push(pointDx);
                        dyList.push(pointDy);
                    }
                }
            }

            // ========================================
            // 9. 전면 카메라 이동 방향 보정
            // ========================================

            // 이전 테스트 결과 기준
            // 오른쪽 이동 -> dx 양수
            // 왼쪽 이동 -> dx 음수
            // 위쪽 이동 -> dy 음수
            // 아래쪽 이동 -> dy 양수

            const rawDx = median(dxList);
            const rawDy = -median(dyList);

            // 원본 이동량 출력
            rawMovementText.textContent =
                `원본 dx: ${rawDx.toFixed(2)} | ` +
                `dy: ${rawDy.toFixed(2)}`;

            // 데드존 + 스무딩 + 감도 조절
            const corrected = applyMovementCorrection(
                rawDx,
                rawDy
            );

            // 보정된 이동량 출력
            movementText.textContent =
                `보정 dx: ${corrected.dx.toFixed(2)} | ` +
                `dy: ${corrected.dy.toFixed(2)}`;

            // 특징점 개수 표시
            pointsText.textContent =
                `추적 특징점: ${dxList.length}`;
        }

        // 이전 프레임 메모리 해제
        if (previousGray !== null) {
            previousGray.delete();
        }

        // 현재 프레임 저장
        previousGray = gray;
        gray = null;

    } catch (error) {

        tracking = false;

        statusText.textContent =
            "영상 분석 오류: " + error.message;

        statusText.style.color = "red";

        console.error(error);

        if (previousGray !== null) {
            previousGray.delete();
            previousGray = null;
        }

    } finally {

        // OpenCV 메모리 해제
        if (src) src.delete();
        if (gray) gray.delete();

        if (prevPts) prevPts.delete();
        if (nextPts) nextPts.delete();

        if (status) status.delete();
        if (err) err.delete();
        if (mask) mask.delete();
    }
}

// ========================================
// 10. 카메라 버튼 이벤트
// ========================================

startBtn.addEventListener("click", startCamera);
