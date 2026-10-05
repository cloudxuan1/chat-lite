// 助手回复分支：每个 reroll 版本各自保存它后面的完整消息链。
// 当前选中的后续仍放在 conversation.messages；其余后续放在该助手消息的 variantBranches 对应槽位。

function variantBranchSlots(message, count) {
  const stored = Array.isArray(message?.variantBranches) ? message.variantBranches : [];
  return Array.from({ length: count }, (_, index) =>
    Array.isArray(stored[index]) ? stored[index] : null
  );
}

function applyAssistantVariant(message, target) {
  message.activeVariant = target;
  message.content = message.variants[target];
  const targetSteps = Array.isArray(message.variantSteps) ? message.variantSteps[target] : null;
  if (targetSteps?.length) message.steps = targetSteps; else delete message.steps;
  const targetReasoning = Array.isArray(message.variantReasoning) ? message.variantReasoning[target] : null;
  if (targetReasoning) message.reasoning = targetReasoning; else delete message.reasoning;
}

// 切换版本时，把眼前的后续收进旧版本，再把目标版本的后续整条取出来。
function switchConversationVariantBranch(conversation, assistantIndex, target) {
  const message = conversation?.messages?.[assistantIndex];
  const count = message?.variants?.length || 0;
  if (message?.role !== "assistant" || count < 2 || target < 0 || target >= count) return false;
  const current = Math.min(Math.max(message.activeVariant ?? count - 1, 0), count - 1);
  if (target === current) return false;

  const branches = variantBranchSlots(message, count);
  branches[current] = conversation.messages.slice(assistantIndex + 1);
  const targetMessages = branches[target] || [];
  branches[target] = null;
  conversation.messages = [
    ...conversation.messages.slice(0, assistantIndex + 1),
    ...targetMessages,
  ];
  applyAssistantVariant(message, target);
  if (branches.some((branch) => branch?.length)) message.variantBranches = branches;
  else delete message.variantBranches;
  return true;
}

// reroll 成功后才原子落盘：旧版本收走当前后续，新版本从空后续开始。
function appendRerolledVariant(conversation, assistantIndex, content, steps = [], reasoning = "") {
  const target = conversation?.messages?.[assistantIndex];
  if (target?.role !== "assistant" || typeof content !== "string" || !content) return false;

  const variants = target.variants?.length ? [...target.variants] : [target.content];
  const current = Math.min(
    Math.max(Number.isInteger(target.activeVariant) ? target.activeVariant : variants.length - 1, 0),
    variants.length - 1,
  );
  const previousSteps = Array.isArray(target.variantSteps)
    ? [...target.variantSteps]
    : variants.map((_, index) => (index === current ? target.steps || null : null));
  const previousReasoning = Array.isArray(target.variantReasoning)
    ? [...target.variantReasoning]
    : variants.map((_, index) => (index === current ? target.reasoning || null : null));
  const branches = variantBranchSlots(target, variants.length);
  branches[current] = conversation.messages.slice(assistantIndex + 1);

  conversation.messages = conversation.messages.slice(0, assistantIndex + 1);
  variants.push(content);
  previousSteps.push(steps.length ? steps : null);
  previousReasoning.push(reasoning || null);
  branches.push(null);

  target.variants = variants;
  target.variantBranches = branches;
  applyAssistantVariant(target, variants.length - 1);
  if (steps.length) target.steps = steps; else delete target.steps;
  if (previousSteps.some(Boolean)) target.variantSteps = previousSteps; else delete target.variantSteps;
  if (reasoning) target.reasoning = reasoning; else delete target.reasoning;
  if (previousReasoning.some(Boolean)) target.variantReasoning = previousReasoning; else delete target.variantReasoning;
  if (!branches.some((branch) => branch?.length)) delete target.variantBranches;
  return true;
}

// 图片可能藏在任意旧分支里；清理、删除和整包备份都必须递归计算引用。
function collectMessageAttachments(messages, depth = 0) {
  if (!Array.isArray(messages) || depth > 40) return [];
  const attachments = [];
  messages.forEach((message) => {
    attachments.push(...(Array.isArray(message?.attachments) ? message.attachments : []));
    if (!Array.isArray(message?.variantBranches)) return;
    message.variantBranches.forEach((branch) => {
      attachments.push(...collectMessageAttachments(branch, depth + 1));
    });
  });
  return attachments;
}
