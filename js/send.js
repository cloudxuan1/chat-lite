// 发送：组装请求、流式接收、打字机渲染、错误处理。
// ===== 发送 =====
async function send() {
  const text = input.value.trim();
  if ((!text && !pendingImages.length) || pending || imageProcessingJobs > 0) return;
  if (
    pendingImages.length &&
    modelImageCapability(modelById(currentModel)) === "unsupported"
  ) {
    showComposerStatus("当前模型不能看图，请先换一个支持图片的模型。", {
      error: true,
      source: "capability",
    });
    return;
  }
  const activeConversation = getActiveConversation();
  const requestConversationId = activeConversation.id;
  const requestSessionId = activeConversation.sessionId;
  const previousTitle = activeConversation.title;
  const previousTitleSource = activeConversation.titleSource;
  const previousUpdatedAt = activeConversation.updatedAt;
  const requestUserIndex = activeConversation.messages.length;
  const shouldGenerateTitle = activeConversation.messages.length === 0;
  const requestModel = currentModel;
  const requestEffort = normalizeEffortForModel(reasoningEffort, modelById(requestModel));
  const requestImages = pendingImages.map((item) => ({ ...item }));
  const requestAttachments = attachmentMetadata(requestImages);

  try {
    await persistPendingImages(requestImages);
  } catch {
    showComposerStatus("图片没有保存成功，暂时没有发送；请重试。", {
      error: true,
      source: "images",
    });
    return;
  }

  const draft = cloneConversationStore();
  const draftConversation = conversationById(requestConversationId, draft);
  if (!draftConversation) return;
  draftConversation.messages.push({
    role: "user",
    content: text,
    ...(requestAttachments.length ? { attachments: requestAttachments } : {}),
  });
  draftConversation.updatedAt = new Date().toISOString();
  if (shouldGenerateTitle && draftConversation.titleSource !== "manual") {
    draftConversation.title = normalizeConversationTitle(text) ||
      (requestAttachments.length ? "图片对话" : "新对话");
    draftConversation.titleSource = draftConversation.title === "新对话" ? "default" : "fallback";
  }
  if (!persistConversationStore(draft)) {
    void deleteImageRecords(requestAttachments).catch(() => {});
    input.focus();
    return;
  }

  input.value = "";
  input.style.height = "auto";
  clearPendingImages();
  addBubble("user", text, requestAttachments, requestConversationId, requestUserIndex);
  renderConversationList();
  showComposerStatus("");

  setPending(true);
  if (shouldGenerateTitle && text) {
    void requestConversationTitle(requestConversationId, text);
  }
  await streamAssistantReply({
    conversationId: requestConversationId,
    sessionId: requestSessionId,
    model: requestModel,
    effort: requestEffort,
    assistantIndex: requestUserIndex + 1,
    // 密码错误时回滚这次乐观写入的用户消息和标题
    onUnauthorized() {
      const rollbackDraft = cloneConversationStore();
      const rollbackConversation = conversationById(requestConversationId, rollbackDraft);
      if (rollbackConversation) {
        const indexedMessage = rollbackConversation.messages[requestUserIndex];
        if (indexedMessage?.role === "user") {
          rollbackConversation.messages.splice(requestUserIndex, 1);
        } else {
          const firstImageId = requestAttachments[0]?.id;
          const fallbackIndex = rollbackConversation.messages.findLastIndex(
            (item) =>
              item.role === "user" &&
              item.content === text &&
              (!firstImageId || item.attachments?.some((attachment) => attachment.id === firstImageId))
          );
          if (fallbackIndex >= 0) rollbackConversation.messages.splice(fallbackIndex, 1);
        }
        rollbackConversation.title = previousTitle;
        rollbackConversation.titleSource = previousTitleSource;
        rollbackConversation.updatedAt = previousUpdatedAt;
        persistConversationStore(rollbackDraft, { keepInMemoryOnFailure: true });
      }
      void deleteImageRecords(requestAttachments).catch(() => {});
    },
  });
}

// send() 和 rerollMessage() 共用的请求流程：建气泡、请求 Worker、流式渲染、落盘助手回复。
// 调用前由调用方 setPending(true)，这里负责收尾 setPending(false)。
// 传 existingBubble 时是 reroll：流进已有气泡，完成后旧正文进 variants、新正文成为当前版本。
async function streamAssistantReply({ conversationId, sessionId, model, effort, assistantIndex, existingBubble, onUnauthorized }) {
  const reasoningBox = effort !== "off" ? addReasoningBlock({ webSearch: webSearchEnabled }) : null;
  const bubble = existingBubble || addBubble("assistant", "", [], conversationId, assistantIndex);
  if (existingBubble) {
    // 思考块从底部挪到被重掷气泡的上方
    if (reasoningBox) bubble.closest(".message-item")?.before(reasoningBox.root);
    bubble.classList.remove("error");
    setBubbleText(bubble, "");
  }
  bubble.classList.add("typing");
  // 流式输出：攒下全文，每帧最多重渲染一次 Markdown
  let streamed = "";
  let renderQueued = false;
  const renderStreamed = () => {
    renderQueued = false;
    setBubbleText(bubble, streamed);
    if (conversationStore.activeId === conversationId) scrollToBottom();
  };

  try {
    const storedConversation = conversationById(conversationId);
    if (!storedConversation) throw new Error("当前会话已不存在");
    // reroll 的上下文只到被重掷的回复之前，不包含旧回复本身
    const history = await messagesForOpenRouter(
      existingBubble
        ? storedConversation.messages.slice(0, assistantIndex)
        : storedConversation.messages,
    );
    const requestSystemPrompt = effectiveSystemPrompt(storedConversation);
    const requestMessages = requestSystemPrompt
      ? [{ role: "system", content: requestSystemPrompt }, ...history]
      : history;
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: requestMessages,
        model,
        password: accessPw,
        reasoningEffort: effort,
        session_id: sessionId,
        webSearch: webSearchEnabled,
        ...(webSearchMaxUses === null ? {} : { webSearchMaxUses }),
        ...(webSearchMaxResults === null ? {} : { webSearchMaxResults }),
        ...(maxCompletionTokens === null ? {} : { maxCompletionTokens }),
      }),
    });

    // 密码错误：清掉本地密码，待会弹回密码界面
    if (res.status === 401) {
      const e = new Error("访问密码错误");
      e.code = 401;
      throw e;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`服务返回 ${res.status}：${errText.slice(0, 300)}`);
    }
    // 正常应是 SSE 流；若不是，多半是 JSON 错误体
    if (!(res.headers.get("Content-Type") || "").includes("text/event-stream")) {
      const data = await res.json().catch(() => null);
      const msg = data?.error?.message || data?.error || "返回了非流式响应";
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }

    const { full, annotations, usage } = await readStream(res.body, {
      onReasoning(delta) {
        if (!reasoningBox) return;
        reasoningBox.append(delta);
        if (conversationStore.activeId === conversationId) scrollToBottom();
      },
      onContent(delta) {
        bubble.classList.remove("typing");
        streamed += delta;
        if (!renderQueued) {
          renderQueued = true;
          requestAnimationFrame(renderStreamed);
        }
      },
    });

    bubble.classList.remove("typing");
    reasoningBox?.finish();
    if (full) {
      streamed = full;
      renderStreamed();
      const completedDraft = cloneConversationStore();
      const completedConversation = conversationById(conversationId, completedDraft);
      if (completedConversation) {
        if (existingBubble) {
          const target = completedConversation.messages[assistantIndex];
          if (target?.role === "assistant") {
            const variants = target.variants?.length ? [...target.variants] : [target.content];
            variants.push(full);
            target.variants = variants;
            target.activeVariant = variants.length - 1;
            target.content = full;
          }
        } else {
          completedConversation.messages.push({ role: "assistant", content: full });
        }
        completedConversation.updatedAt = new Date().toISOString();
        persistConversationStore(completedDraft, { keepInMemoryOnFailure: true });
        renderConversationList();
      }
      if (conversationStore.activeId === conversationId) {
        revealMessageTools(bubble);
        const item = bubble.closest(".message-item");
        // 刚流式生成的气泡建时没有正文，这里补上复制按钮的内容
        const copy = item?.querySelector(".message-copy");
        if (copy) {
          copy.dataset.copyText = full;
          copy.hidden = false;
        }
        const storedMessage = getActiveConversation().messages[assistantIndex];
        if (item && storedMessage) updateVariantSwitcher(item, storedMessage);
        addCitations(annotations);
        addCacheBadge(usage, model);
      }
    } else {
      bubble.classList.add("error");
      bubble.classList.remove("md");
      bubble.textContent = "⚠️ 没有收到回复内容";
    }
  } catch (err) {
    reasoningBox?.finish();
    bubble.classList.remove("typing");
    bubble.classList.add("error");
    bubble.classList.remove("md");
    bubble.textContent = "⚠️ " + err.message;
    if (err.code === 401) {
      localStorage.removeItem(PW_KEY);
      accessPw = "";
      onUnauthorized?.();
      renderConversationList();
      renderActiveConversation();
      showGate("密码错误，请重新输入");
    }
  } finally {
    setPending(false);
    if (conversationStore.activeId === conversationId) scrollToBottom();
  }
}
