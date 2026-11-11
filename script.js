
const video = document.getElementById("camera");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

// 이동량 표시 화면
const display = document.createElement("div");

display.innerHTML = `
    <h3>카메라 이동량</h3>
    <p id="movement">dx: 0.00 | dy: 0.00</p>
    <p id="points">추적 특징점: 0</p>
    <p id="opencvStatus">OpenCV 로딩 중...</p>
`;

video.before(display);

const movementText = document.getElementById("movement");
const pointsText = document.getElementById("points");
const opencvStatus = document.getElementById("opencvStatus");

// 영상 분석용 캔버스
const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 240;

const ctx = canvas.getContext("2d", {
    willReadFrequently: true
});

// 전역 변수
let cvLib = null;
let previousGray = null;
let tracking = false;
let lastTime = 0;
let promiseAttached = false;

// ========================================
// 1. OpenCV 초기화
// ========================================

function setOpenCVReady(module) {
    if (!module || typeof module.Mat !== "function") {
        return false;
    }

    cvLib = module;
    opencvStatus.textContent = "OpenCV 준비 완료";
    opencvStatus.style.color = "green";

    console.log("OpenCV 초기화 성공");
    return true;
}

function checkOpenCV() {
    if (cvLib) return;

    const candidate = window.cv;

    // 이미 초기화된 OpenCV
    if (setOpenCVReady(candidate)) {
        return;
    }

    // Promise 방식의 OpenCV
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
                "OpenCV 초기화 오류: " + error.message;
            console.error(error);
        });
    }
}

// 일부 OpenCV 배포 방식에서 사용하는 콜백
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
        opencvStatus.textContent = "OpenCV 초기화 중...";

        // 초기화가 완료되었는지 주기적으로 확인
        const interval = setInterval(() => {
            checkOpenCV();

            if (cvLib) {
                clearInterval(interval);
            }
        }, 200);

        // 초기화가 지나치게 오래 걸리면 안내
        setTimeout(() => {
            clearInterval(interval);

            if (!cvLib) {
                opencvStatus.textContent =
                    "OpenCV 초기화 지연 또는 실패";
                opencvStatus.style.color = "red";
            }
        }, 60000);
    }
};

library.onerror = function () {
    opencvStatus.textContent =
        "OpenCV 다운로드 실패. 인터넷 연결 확인";
    opencvStatus.style.color = "red";
};

document.head.appendChild(library);

// ========================================
// 2. iPhone 카메라 실행
// ========================================

async function startCamera() {
    try {
        statusText.textContent = "카메라 연결 중...";

        const stream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            });

        video.srcObject = stream;

        await video.play();

        statusText.textContent = "카메라 실행 중";
        statusText.style.color = "green";

        startBtn.disabled = true;

        tracking = true;
        requestAnimationFrame(trackMotion);

    } catch (error) {
        statusText.textContent =
            "카메라 실행 실패: " + error.message;

        console.error(error);
    }
}

// ========================================
// 3. 중앙값 계산
// ========================================

// 잘못 추적된 일부 특징점의 영향을 줄이기 위해 사용
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
// 4. Optical Flow 이동량 계산
// ========================================

function trackMotion(timestamp) {
    if (!tracking) return;

    requestAnimationFrame(trackMotion);

    // 약 10FPS로 영상 분석
    if (timestamp - lastTime < 100) {
        return;
    }

    // OpenCV 및 영상 준비 확인
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
        // 카메라 영상을 캔버스에 그리기
        ctx.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        src = cvLib.imread(canvas);
        gray = new cvLib.Mat();

        // 컬러 영상을 흑백으로 변환
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

            // 이전 프레임에서 특징점 탐색
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

                // 정상적으로 추적된 특징점만 계산
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

            // 카메라 이동 방향을 추정
            const dx = -median(dxList);
            const dy = -median(dyList);

            // 화면에 이동량 표시
            movementText.textContent =
                `dx: ${dx.toFixed(2)} | dy: ${dy.toFixed(2)}`;

            pointsText.textContent =
                `추적 특징점: ${dxList.length}`;
        }

        // 이전 프레임 메모리 해제
        if (previousGray !== null) {
            previousGray.delete();
        }

        // 현재 프레임을 다음 비교에 사용
        previousGray = gray;
        gray = null;

    } catch (error) {
        tracking = false;

        statusText.textContent =
            "영상 분석 오류: " + error.message;

        statusText.style.color = "red";

        console.error(error);

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
// 5. 카메라 버튼 이벤트
// ========================================

startBtn.addEventListener("click", startCamera);
