import * as skinview3d from "skinview3d";

type SkinViewer = InstanceType<typeof skinview3d.SkinViewer>;

// Head-only framing.
// In skinview3d's PlayerObject, the head BodyPart sits at skin-local
// (0,0,0) but the inner mesh has position.y = 4, so the 8×8×8 head spans
// world y = 0..8 (centre y = 4). The camera looks at the world origin, so
// translating the player down by 4 puts the head centre on the camera
// target.
const HEAD_OFFSET_Y = -12;
// Tight frame for head-only (full body uses 0.9). 1.5 leaves a small
// margin so the outer hat layer is not clipped.
const HEAD_ZOOM = 2.5;

function setHeadOnly(viewer: SkinViewer) {
  const skin = viewer.playerObject.skin;
  skin.body.visible = false;
  skin.leftArm.visible = false;
  skin.rightArm.visible = false;
  skin.leftLeg.visible = false;
  skin.rightLeg.visible = false;
  viewer.playerObject.position.set(0, HEAD_OFFSET_Y, 0);
}

function b64ToDataUrl(b64: string) {
  return `data:image/png;base64,${b64}`;
}

// --- filters ---
const rows = Array.from(document.querySelectorAll<HTMLElement>(".member-row"));
const chips = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#branch-chips .chip"),
);
const search = document.getElementById("search") as HTMLInputElement;
const countEl = document.getElementById("count")!;
const emptyEl = document.getElementById("empty")!;

let activeBranch = "all";
let query = "";

function applyFilters() {
  let visMembers = 0,
    visHeads = 0;
  for (const row of rows) {
    const branch = row.dataset.branch;
    const name = row.dataset.name || "";
    const matchBranch = activeBranch === "all" || branch === activeBranch;
    const matchQuery = !query || name.includes(query);
    const show = matchBranch && matchQuery;
    row.hidden = !show;
    if (show) {
      visMembers++;
      visHeads += row.querySelectorAll(".head-card").length;
    }
  }
  countEl.textContent = visMembers + " メンバー / " + visHeads + " 種";
  emptyEl.hidden = visMembers > 0;
}

for (const chip of chips) {
  chip.addEventListener("click", () => {
    activeBranch = chip.dataset.branch || "all";
    chips.forEach((c) => c.classList.toggle("active", c === chip));
    applyFilters();
  });
}
search.addEventListener("input", () => {
  query = search.value.trim().toLowerCase();
  applyFilters();
});

// --- card hover -> skinview3d ---
let activeCard: HTMLElement | null = null;
let activeViewer: SkinViewer | null = null;
let activationTimer: number | null = null;

function deactivateCard() {
  if (activeViewer) {
    try {
      activeViewer.dispose();
    } catch {
      /* ignore */
    }
    activeViewer = null;
  }
  if (activeCard) {
    const canvas = activeCard.querySelector<HTMLCanvasElement>(".head-3d");
    if (canvas) canvas.hidden = true;
    activeCard.classList.remove("is-3d");
    activeCard = null;
  }
}

function activateCard(card: HTMLElement) {
  if (activeCard === card) return;
  deactivateCard();
  const canvas = card.querySelector<HTMLCanvasElement>(".head-3d");
  const thumb = card.querySelector<HTMLElement>(".head-thumb");
  const b64 = card.dataset.b64;
  if (!canvas || !thumb || !b64) return;
  // Use the thumb's rendered size for the canvas. skinview3d delegates to
  // three.js's WebGLRenderer.setSize, which inline-sets canvas.style.width
  // /height and overrides any CSS sizing — passing the card width here
  // would make the canvas overflow the thumb container.
  const size = Math.max(64, Math.round(thumb.getBoundingClientRect().width));
  activeCard = card;
  card.classList.add("is-3d");
  canvas.hidden = false;
  const viewer = new skinview3d.SkinViewer({
    canvas,
    width: size,
    height: size,
    skin: b64ToDataUrl(b64),
    enableControls: false,
    fov: 50,
    zoom: HEAD_ZOOM,
    pixelRatio: "match-device",
  });
  setHeadOnly(viewer);
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 1.4;
  activeViewer = viewer;
}

function scheduleActivate(card: HTMLElement) {
  if (activationTimer !== null) window.clearTimeout(activationTimer);
  activationTimer = window.setTimeout(() => activateCard(card), 70);
}

function cancelActivation() {
  if (activationTimer !== null) {
    window.clearTimeout(activationTimer);
    activationTimer = null;
  }
}

document.addEventListener("pointerover", (e) => {
  const target = e.target as Element | null;
  const card = target?.closest<HTMLElement>(".head-card");
  if (card) scheduleActivate(card);
});
document.addEventListener("pointerout", (e) => {
  const target = e.target as Element | null;
  const card = target?.closest<HTMLElement>(".head-card");
  if (!card) return;
  const related = (e as PointerEvent).relatedTarget as Element | null;
  if (related && card.contains(related)) return;
  cancelActivation();
  if (activeCard === card) deactivateCard();
});

// --- modal (skinview3d w/ orbit controls) ---
const modal = document.getElementById("head-modal") as HTMLDialogElement;
const modalCanvas = document.getElementById(
  "modal-canvas",
) as HTMLCanvasElement;
const modalMember = document.getElementById("modal-member")!;
const modalSub = document.getElementById("modal-sub")!;
const modalHash = document.getElementById("modal-hash")!;
const modalCopy = document.getElementById("modal-copy") as HTMLButtonElement;
let modalViewer: SkinViewer | null = null;
let currentHash = "";

function modalStageSize() {
  const isNarrow = window.matchMedia("(max-width: 760px)").matches;
  return isNarrow ? 240 : 360;
}

function ensureModalViewer() {
  if (modalViewer) return modalViewer;
  const size = modalStageSize();
  modalViewer = new skinview3d.SkinViewer({
    canvas: modalCanvas,
    width: size,
    height: size,
    enableControls: true,
    background: "transparent",
    fov: 50,
    zoom: HEAD_ZOOM,
    pixelRatio: "match-device",
  });
  return modalViewer;
}

async function openModal(card: HTMLElement) {
  const b64 = card.dataset.b64;
  if (!b64) return;
  const viewer = ensureModalViewer();
  viewer.setSize(modalStageSize(), modalStageSize());
  // Deactivate any active card viewer so its WebGL context is freed
  // while the modal is open.
  deactivateCard();
  await viewer.loadSkin(b64ToDataUrl(b64));
  setHeadOnly(viewer);
  viewer.resetCameraPose();
  viewer.renderPaused = false;

  modalMember.textContent = card.dataset.member ?? "";
  modalSub.textContent =
    "バリエーション #" + String(card.dataset.idx ?? "").padStart(2, "0");
  modalHash.textContent = card.dataset.hash ?? "";
  currentHash = card.dataset.hash ?? "";

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

function closeModal() {
  if (modalViewer) modalViewer.renderPaused = true;
  if (typeof modal.close === "function") modal.close();
  else modal.removeAttribute("open");
}

document.addEventListener("click", (e) => {
  const target = e.target as Element | null;
  const card = target?.closest<HTMLElement>(".head-card");
  if (card) {
    e.preventDefault();
    void openModal(card);
    return;
  }
  if (target?.closest("[data-modal-close]")) {
    closeModal();
    return;
  }
  if (target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.open) closeModal();
});

modalCopy.addEventListener("click", async () => {
  const url = "https://textures.minecraft.net/texture/" + currentHash;
  try {
    await navigator.clipboard.writeText(url);
    modalCopy.textContent = "コピーしました!";
    window.setTimeout(() => {
      modalCopy.textContent = "テクスチャURLをコピー";
    }, 1500);
  } catch {
    modalCopy.textContent = "コピーに失敗しました";
  }
});

window.addEventListener("resize", () => {
  if (modalViewer && modal.open) {
    const size = modalStageSize();
    modalViewer.setSize(size, size);
  }
});
