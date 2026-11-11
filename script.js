
const video = document.getElementById("camera");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

async function startCamera() {
    try {
        statusText.textContent = "카메라 연결 중...";

        const stream = await navigator.mediaDevices.getUserMedia({
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
    } catch (error) {
        statusText.textContent = "카메라 실행 실패: " + error.message;
        console.error(error);
    }
}

startBtn.addEventListener("click", startCamera);
