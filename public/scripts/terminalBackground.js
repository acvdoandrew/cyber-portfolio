const canvas = document.getElementById("terminal-bg");
if (canvas) {
  // Check if canvas exists
  const ctx = canvas.getContext("2d");

  let animationFrameId;

  function setupCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  setupCanvas();

  // Characters to use - using a mix for a more "corrupted data" feel
  let chars =
    "abcdefghijklmnopqrstuvwxyz0123456789ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ!@#$%^&*()_+-=[]{};':|,.<>/?`~";
  chars = chars.split("");

  const fontSize = 10; // Keep it small for density, but we'll dim it
  let columns = Math.floor(canvas.width / fontSize); // Ensure integer
  const drops = [];

  function initializeDrops() {
    columns = Math.floor(canvas.width / fontSize);
    drops.length = 0; // Clear existing drops
    for (let x = 0; x < columns; x++) {
      drops[x] = 1 + Math.random() * -100; // Start some drops off-screen or delayed
    }
  }
  initializeDrops();

  function draw() {
    // Adjusted background fill: Trails fade a bit more, but not too fast.
    // Using the actual --bg-color from CSS would be ideal if we could pass it,
    // but for simplicity, hardcoding a similar color.
    ctx.fillStyle = "rgba(22, 19, 29, 0.9)"; // Dark Indigo (from CSS --bg-color) with higher alpha for faster fade
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dimmer characters for the background rain
    ctx.fillStyle = "rgba(152, 144, 168, 0.45)"; // Dimmer version of --accent-blue (original: #40C4FF)
    ctx.font = fontSize + 'px "Share Tech Mono", monospace';

    for (let i = 0; i < drops.length; i++) {
      if (drops[i] * fontSize < 0 && Math.random() < 0.025) {
        // Chance to restart a drop that is way off screen
        drops[i] = 1;
      }
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.97) {
        // Slower reset
        drops[i] = 0;
      }
      if (drops[i] * fontSize > 0) {
        // Only draw if on screen
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
      }
      drops[i]++;
    }
    animationFrameId = requestAnimationFrame(draw);
  }

  draw();

  window.addEventListener("resize", () => {
    cancelAnimationFrame(animationFrameId); // Stop old animation
    setupCanvas();
    initializeDrops();
    draw(); // Restart animation
  });
} else {
  console.warn("Terminal background canvas not found.");
}
