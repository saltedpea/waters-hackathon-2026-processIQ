/* Login page: icon rendering, forgot-password hint, and the process-network canvas. */

function renderIcons() {
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

document.addEventListener("DOMContentLoaded", () => {
  renderIcons();
  window.addEventListener("themechange", () => setTimeout(renderIcons, 0));

  const forgot = document.getElementById("forgot");
  if (forgot) {
    forgot.addEventListener("click", () => {
      forgot.textContent = "Contact your ProcessIQ administrator";
      forgot.disabled = true;
      forgot.style.color = "var(--text-3)";
    });
  }

  startNetwork();
});

/* A quiet network of process nodes, connected systems and data streams. */
function startNetwork() {
  const canvas = document.getElementById("auth-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let nodes = [];
  let streams = [];
  const pointer = { x: -999, y: -999 };

  function palette() {
    const styles = getComputedStyle(document.documentElement);
    const light = document.documentElement.getAttribute("data-theme") === "light";
    return {
      node: styles.getPropertyValue("--accent").trim() || "#2ea8ff",
      accent2: styles.getPropertyValue("--accent-2").trim() || "#17c9c0",
      line: light ? "rgba(11, 116, 212, 0.16)" : "rgba(46, 168, 255, 0.14)",
      grid: light ? "rgba(120, 145, 175, 0.12)" : "rgba(46, 168, 255, 0.05)",
      nodeAlpha: light ? 0.55 : 0.75,
    };
  }
  let colors = palette();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    build();
  }

  function build() {
    const target = Math.round((width * height) / 26000);
    const total = Math.max(16, Math.min(46, target));
    nodes = Array.from({ length: total }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      r: Math.random() < 0.18 ? 3.1 : 1.7,
      hub: Math.random() < 0.18,
    }));
    streams = [];
  }

  function spawnStream() {
    if (nodes.length < 2 || streams.length > 5) return;
    const from = Math.floor(Math.random() * nodes.length);
    let to = Math.floor(Math.random() * nodes.length);
    if (to === from) to = (to + 1) % nodes.length;
    const a = nodes[from];
    const b = nodes[to];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 230) return;
    streams.push({ from, to, t: 0 });
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // faint technical grid
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const step = 46;
    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, height);
    }
    for (let y = 0; y <= height; y += step) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(width, Math.floor(y) + 0.5);
    }
    ctx.stroke();

    nodes.forEach((node) => {
      node.x += node.vx;
      node.y += node.vy;
      if (node.x < 0 || node.x > width) node.vx *= -1;
      if (node.y < 0 || node.y > height) node.vy *= -1;

      const dx = node.x - pointer.x;
      const dy = node.y - pointer.y;
      const near = Math.hypot(dx, dy);
      if (near < 130) {
        node.x += (dx / (near || 1)) * 0.5;
        node.y += (dy / (near || 1)) * 0.5;
      }
    });

    // links
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 148) continue;
        ctx.globalAlpha = 1 - distance / 148;
        ctx.strokeStyle = colors.line;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // data streams travelling along links
    streams = streams.filter((stream) => stream.t < 1);
    streams.forEach((stream) => {
      const a = nodes[stream.from];
      const b = nodes[stream.to];
      if (!a || !b) return;
      stream.t += 0.012;
      const x = a.x + (b.x - a.x) * stream.t;
      const y = a.y + (b.y - a.y) * stream.t;
      ctx.globalAlpha = Math.sin(stream.t * Math.PI) * 0.85;
      ctx.fillStyle = colors.accent2;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // nodes
    nodes.forEach((node) => {
      ctx.globalAlpha = colors.nodeAlpha;
      ctx.fillStyle = node.hub ? colors.accent2 : colors.node;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fill();
      if (node.hub) {
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = colors.accent2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    if (Math.random() < 0.035) spawnStream();
    requestAnimationFrame(draw);
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.x = -999;
    pointer.y = -999;
  });

  window.addEventListener("resize", resize);
  window.addEventListener("themechange", () => {
    colors = palette();
  });

  resize();
  draw();
}
