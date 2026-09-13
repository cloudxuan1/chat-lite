// 图片附件：压缩、预览条、入库、组装成 OpenRouter 消息。
function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("这张图片无法读取"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("压缩图片失败")),
      type,
      quality,
    );
  });
}

async function prepareImageBlob(file) {
  if (imageQuality === "original" || file.type === "image/gif") return file;
  const image = await loadImageElement(file);
  const scale = Math.min(
    1,
    AUTO_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("这个浏览器无法压缩图片");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const compressed = await canvasToBlob(canvas, "image/webp", AUTO_IMAGE_QUALITY);
  return compressed.size < file.size ? compressed : file;
}

async function currentImageCapability() {
  let capability = modelImageCapability(modelById(currentModel));
  if (
    capability !== "unknown" ||
    modelsLoadedThisPage ||
    imageCapabilityLookupAttempted ||
    !accessPw
  ) {
    return capability;
  }
  imageCapabilityLookupAttempted = true;
  await fetchModels({ force: true });
  capability = modelImageCapability(modelById(currentModel));
  return capability;
}

function renderPendingImages() {
  composerAttachments.replaceChildren();
  pendingImages.forEach((item) => {
    const root = document.createElement("span");
    root.className = "composer-image";
    const image = document.createElement("img");
    image.src = item.previewUrl;
    image.alt = item.name;
    const remove = document.createElement("button");
    remove.className = "composer-image-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${item.name}`);
    remove.dataset.imageId = item.id;
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>';
    root.append(image, remove);
    composerAttachments.appendChild(root);
  });
  composerAttachments.classList.toggle("has-images", Boolean(pendingImages.length));
  updateConversationActionState();
}

function clearPendingImages() {
  pendingImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  pendingImages = [];
  imageFileInput.value = "";
  renderPendingImages();
}

function removePendingImage(imageId) {
  const target = pendingImages.find((item) => item.id === imageId);
  if (target) URL.revokeObjectURL(target.previewUrl);
  pendingImages = pendingImages.filter((item) => item.id !== imageId);
  imageFileInput.value = "";
  renderPendingImages();
  if (composerStatus.dataset.source === "images") showComposerStatus("");
}

async function addImageFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const capability = await currentImageCapability();
  if (!accessPw) return;
  if (capability === "unsupported") {
    showComposerStatus("当前模型不能看图，请先换一个支持图片的模型。", {
      error: true,
      source: "capability",
    });
    return;
  }
  const available = MAX_IMAGES_PER_MESSAGE - pendingImages.length;
  if (available <= 0) {
    showComposerStatus("每条消息最多发送 8 张图片。", { error: true, source: "images" });
    return;
  }
  const acceptedFiles = files.slice(0, available);
  if (files.length > available) {
    showComposerStatus(`已保留前 ${available} 张；每条消息最多发送 8 张。`, {
      error: true,
      source: "images",
    });
  } else if (composerStatus.dataset.source !== "processing") {
    showComposerStatus("");
  }

  let totalBytes = pendingImages.reduce((sum, item) => sum + item.size, 0);
  for (const file of acceptedFiles) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      showComposerStatus("只支持 PNG、JPEG、WebP 或 GIF 图片。", {
        error: true,
        source: "images",
      });
      continue;
    }
    let blob;
    try {
      blob = await prepareImageBlob(file);
    } catch (error) {
      showComposerStatus(error.message || "处理图片失败。", {
        error: true,
        source: "images",
      });
      continue;
    }
    if (totalBytes + blob.size > MAX_IMAGE_BYTES_PER_MESSAGE) {
      showComposerStatus("这些图片合计超过 6MB；移除一些或改用自动压缩。", {
        error: true,
        source: "images",
      });
      continue;
    }
    const name = file.name || `图片 ${pendingImages.length + 1}`;
    pendingImages.push({
      id: createImageId(),
      name,
      type: blob.type || file.type,
      size: blob.size,
      blob,
      previewUrl: URL.createObjectURL(blob),
    });
    totalBytes += blob.size;
    renderPendingImages();
  }
  imageFileInput.value = "";
  input.focus();
}

function queueImageFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  imageProcessingJobs += 1;
  if (imageProcessingJobs === 1) {
    showComposerStatus("正在处理图片…", { source: "processing" });
  }
  updateConversationActionState();
  imageProcessingQueue = imageProcessingQueue
    .then(() => addImageFiles(files))
    .catch((error) => {
      showComposerStatus(error?.message || "处理图片失败。", {
        error: true,
        source: "images",
      });
    })
    .finally(() => {
      imageProcessingJobs = Math.max(0, imageProcessingJobs - 1);
      if (imageProcessingJobs === 0 && composerStatus.dataset.source === "processing") {
        showComposerStatus("");
      }
      updateConversationActionState();
    });
}

function attachmentMetadata(images) {
  return images.map(({ id, name, type, size }) => ({ id, name, type, size }));
}

async function persistPendingImages(images) {
  await putImageRecords(images.map(({ id, name, type, size, blob }) => ({
    id,
    name,
    type,
    size,
    blob,
    createdAt: new Date().toISOString(),
  })));
}

async function messageForOpenRouter(item) {
  const attachments = item.attachments || [];
  if (!attachments.length) return { role: item.role, content: item.content };
  const records = await getImageRecords(attachments);
  const imageBlocks = [];
  for (const record of records) {
    if (!record?.blob) continue;
    imageBlocks.push({
      type: "image_url",
      image_url: { url: await blobToDataUrl(record.blob) },
    });
  }
  const text = item.content.trim() || (
    imageBlocks.length
      ? "请查看这些图片并回答。"
      : "〔此前发送的图片已不在本机〕"
  );
  return {
    role: item.role,
    content: [
      { type: "text", text },
      ...imageBlocks,
    ],
  };
}

async function messagesForOpenRouter(messages) {
  return Promise.all(messages.map(messageForOpenRouter));
}
