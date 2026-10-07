// No dependencies or network: node --test tests/reroll-branches.test.mjs
// reroll 分支：重生成保留完整后续，箭头切换整条分支，失败不改原消息，隐藏分支图片仍算存活。
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { source as script } from "./source.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const branchSource = readFileSync(new URL("../js/conversation-branches.js", import.meta.url), "utf8");
const sendSource = readFileSync(new URL("../js/send.js", import.meta.url), "utf8");

function extract(pattern) {
  const matches = [...script.matchAll(pattern)];
  assert.equal(matches.length, 1, `production source extraction must be unique: ${pattern}`);
  return matches[0][0];
}

function branchHarness() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(branchSource, context);
  return context;
}

test("reroll 后旧、新版本各自保留完整后续，来回切换不串分支", () => {
  const h = branchHarness();
  const oldSteps = [{ role: "tool", tool_call_id: "old", content: "旧记忆" }];
  const newSteps = [{ role: "tool", tool_call_id: "new", content: "新记忆" }];
  const oldSuffix = [
    { role: "user", content: "沿旧回答追问", attachments: [{ id: "old-image" }] },
    { role: "assistant", content: "旧分支回答", reasoning: "旧分支思考" },
  ];
  const conversation = {
    messages: [
      { role: "user", content: "问题" },
      { role: "assistant", content: "旧回答", steps: oldSteps, reasoning: "旧思考" },
      ...plain(oldSuffix),
    ],
  };

  assert.equal(h.appendRerolledVariant(conversation, 1, "新回答", newSteps, "新思考"), true);
  assert.deepEqual(plain(conversation.messages), [
    { role: "user", content: "问题" },
    {
      role: "assistant", content: "新回答", steps: newSteps, reasoning: "新思考",
      variants: ["旧回答", "新回答"], activeVariant: 1,
      variantSteps: [oldSteps, newSteps], variantReasoning: ["旧思考", "新思考"],
      variantBranches: [oldSuffix, null],
    },
  ]);

  conversation.messages.push(
    { role: "user", content: "沿新回答追问", attachments: [{ id: "new-image" }] },
    { role: "assistant", content: "新分支回答" },
  );
  const newSuffix = plain(conversation.messages.slice(2));
  assert.equal(h.switchConversationVariantBranch(conversation, 1, 0), true);
  assert.deepEqual(plain(conversation.messages.slice(2)), oldSuffix);
  assert.equal(conversation.messages[1].content, "旧回答");
  assert.deepEqual(plain(conversation.messages[1].steps), oldSteps);
  assert.equal(conversation.messages[1].reasoning, "旧思考");

  assert.equal(h.switchConversationVariantBranch(conversation, 1, 1), true);
  assert.deepEqual(plain(conversation.messages.slice(2)), newSuffix);
  assert.equal(conversation.messages[1].content, "新回答");
  assert.deepEqual(plain(conversation.messages[1].steps), newSteps);
  assert.equal(conversation.messages[1].reasoning, "新思考");
  assert.deepEqual(
    plain(h.collectMessageAttachments(conversation.messages).map((item) => item.id).sort()),
    ["new-image", "old-image"],
    "当前分支和隐藏分支的图片都必须保持引用",
  );
});

test("存档归一化递归保留分支消息、图片和嵌套 reroll 数据", () => {
  const functionNames = [
    "normalizeMemoryContext", "normalizeToolCalls", "normalizeReasoningDetailsList", "normalizeMemorySteps",
    "normalizeVariantSteps", "normalizeVariantReasoning", "normalizeMessageAttachments", "normalizeStoredMessages",
  ];
  const functions = functionNames
    .map((name) => extract(new RegExp(`^(?:async )?function ${name}\\([^]*?^}$`, "gm")))
    .join("\n");
  const constants = ["MEMORY_CONTEXT_MAX_CHARS", "MEMORY_TOOL_NAMES", "MAX_IMAGES_PER_MESSAGE", "SUPPORTED_IMAGE_TYPES"]
    .map((name) => extract(new RegExp(`^const ${name} = [^]*?;$`, "gm")))
    .join("\n");
  const h = {};
  vm.createContext(h);
  vm.runInContext(`${constants}\n${functions}`, h);
  const stored = h.normalizeStoredMessages([{
    role: "assistant", content: "新", variants: ["旧", "新"], activeVariant: 1,
    variantBranches: [[
      { role: "user", content: "旧追问", attachments: [{ id: "img", name: "图", type: "image/png", size: 2 }] },
      { role: "assistant", content: "里二", variants: ["里一", "里二"], activeVariant: 1 },
      { role: "system", content: "丢掉" },
    ], null],
  }]);
  assert.equal(stored[0].content, "新");
  assert.equal(stored[0].variantBranches[0][0].attachments[0].id, "img");
  assert.deepEqual(plain(stored[0].variantBranches[0][1]), {
    role: "assistant", content: "里二", variants: ["里一", "里二"], activeVariant: 1,
  });
  assert.equal(stored[0].variantBranches[0].length, 2);
});

test("reroll 请求失败时恢复原气泡，存档和整条后续完全不变", async () => {
  const conversation = {
    messages: [
      { role: "user", content: "问题" },
      { role: "assistant", content: "旧回答" },
      { role: "user", content: "后续", attachments: [{ id: "keep-image" }] },
    ],
  };
  const before = plain(conversation);
  const bubble = { classList: { add() {}, remove() {} }, closest: () => null };
  let renders = 0;
  let status = "";
  const context = {
    memoryMaxToolRounds: 6, memoryEnabled: false, WORKER_URL: "https://mock.invalid",
    accessPw: "mock", webSearchEnabled: false, webSearchMaxUses: null,
    webSearchMaxResults: null, maxCompletionTokens: null,
    conversationStore: { activeId: "test" },
    setBubbleText() {}, findMemoryStepsTrace: () => null, findReasoningTrace: () => null,
    conversationById: () => conversation, messagesForOpenRouter: async (items) => items,
    effectiveSystemPrompt: () => "", expandMemorySteps: (items) => items,
    fetch: async () => { throw new Error("断网"); },
    renderActiveConversation: () => { renders += 1; }, showAppStatus: (message) => { status = message; },
    setPending() {}, scrollToBottom() {},
  };
  vm.createContext(context);
  vm.runInContext(`${branchSource}\n${sendSource}`, context);
  await context.streamAssistantReply({
    conversationId: "test", sessionId: "s", model: "mock", effort: "off",
    assistantIndex: 1, existingBubble: bubble,
  });
  assert.deepEqual(plain(conversation), before);
  assert.equal(renders, 1);
  assert.match(status, /原分支已保留/);
});

test("中段 reroll 生成期间只从屏幕收起后续节点，存档不动，结束后靠整段重画恢复", async () => {
  const conversation = {
    messages: [
      { role: "user", content: "问题" },
      { role: "assistant", content: "旧回答" },
      { role: "user", content: "后续" },
      { role: "assistant", content: "后续回答" },
    ],
  };
  const before = plain(conversation);
  const sibling = (next = null) => {
    const classes = [];
    return { classes, classList: { add: (name) => classes.push(name) }, nextElementSibling: next };
  };
  const badge = sibling();
  const laterReply = sibling(badge);
  const laterQuestion = sibling(laterReply);
  const earlier = sibling();
  const item = { nextElementSibling: laterQuestion, previousElementSibling: earlier, before() {} };
  const bubble = { classList: { add() {}, remove() {} }, closest: () => item };
  let renders = 0;
  let hiddenWhenRequested = null;
  const context = {
    memoryMaxToolRounds: 6, memoryEnabled: false, WORKER_URL: "https://mock.invalid",
    accessPw: "mock", webSearchEnabled: false, webSearchMaxUses: null,
    webSearchMaxResults: null, maxCompletionTokens: null,
    conversationStore: { activeId: "test" },
    setBubbleText() {}, findMemoryStepsTrace: () => null, findReasoningTrace: () => null,
    conversationById: () => conversation, messagesForOpenRouter: async (items) => items,
    effectiveSystemPrompt: () => "", expandMemorySteps: (items) => items,
    fetch: async () => {
      hiddenWhenRequested = [laterQuestion, laterReply, badge].map((node) => node.classes.join(" "));
      throw new Error("断网");
    },
    renderActiveConversation: () => { renders += 1; }, showAppStatus() {},
    setPending() {}, scrollToBottom() {},
  };
  vm.createContext(context);
  vm.runInContext(`${branchSource}\n${sendSource}`, context);
  await context.streamAssistantReply({
    conversationId: "test", sessionId: "s", model: "mock", effort: "off",
    assistantIndex: 1, existingBubble: bubble,
  });
  assert.deepEqual(hiddenWhenRequested, ["is-reroll-stale", "is-reroll-stale", "is-reroll-stale"], "请求发出前后续就该收起");
  assert.deepEqual(earlier.classes, [], "被重掷回复之前的内容不能动");
  assert.deepEqual(plain(conversation), before, "只改屏幕，不改存档");
  assert.equal(renders, 1, "失败后整段重画，把收起的后续放回来");
});
