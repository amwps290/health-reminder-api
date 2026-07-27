import { expect, test } from "@playwright/test";

test("logs in and renders responsive navigation", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "管理端登录" })).toBeVisible();
  await page.getByLabel("管理令牌").fill("local-admin-token-at-least-16");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "今日", exact: true })).toBeVisible();

  if (testInfo.project.name === "mobile") {
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
  } else {
    await expect(page.locator(".sidebar")).toBeVisible();
  }
  await page.screenshot({ path: `../test-results/${testInfo.project.name}-dashboard.png`, fullPage: true });
});

test("creates and removes a medication plan", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("管理令牌").fill("local-admin-token-at-least-16");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "服药" }).click();
  await expect(page.getByRole("heading", { name: "服药计划" })).toBeVisible();
  const addButton = page.getByRole("button", { name: "新增" });
  await addButton.click();
  await expect(page.getByRole("button", { name: "测试通知" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "新增服药计划" })).toHaveCount(0);
  await expect(addButton).toBeFocused();
  await addButton.click();

  const name = `页面测试-${testInfo.project.name}`;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("单次剂量").fill("1 片");
  await page.getByLabel("服用说明").fill("饭后服用");
  await page.locator(".modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog", { name: "新增服药计划" })).toBeVisible();
  await page.getByLabel("开始日期").fill(tomorrow);
  await page.getByRole("button", { name: "每日时间 1" }).click();
  await page.getByRole("button", { name: "09" }).click();
  await page.getByRole("button", { name: "30" }).click();
  await page.getByRole("button", { name: "完成" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  const card = page.getByRole("article").filter({ hasText: name });
  await expect(card.getByRole("heading", { name })).toBeVisible();

  await card.getByRole("button", { name: "服用记录" }).click();
  const recordDialog = page.getByRole("dialog", { name: `${name} · 服用记录` });
  await recordDialog.getByRole("button", { name: "保存记录" }).click();
  await expect(recordDialog).toContainText("服用记录已保存");
  await expect(recordDialog).toContainText("已服用");
  await recordDialog.locator("form").getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: `../test-results/${testInfo.project.name}-medications.png`, fullPage: true });

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("heading", { name })).toHaveCount(0);
});

test("creates an alternating injection plan", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("管理令牌").fill("local-admin-token-at-least-16");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "注射" }).click();
  await expect(page.getByRole("heading", { name: "注射计划" })).toBeVisible();
  await page.getByRole("button", { name: "新增" }).click();
  await expect(page.getByRole("button", { name: "测试通知" })).toBeVisible();

  const name = `注射测试-${testInfo.project.name}`;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("单次剂量").fill("1 支");
  await page.getByLabel("开始日期").fill(tomorrow);
  await page.getByLabel("注射间隔（天）").fill("3");
  await page.getByRole("button", { name: "右侧" }).click();
  await page.getByRole("button", { name: "保存" }).click();

  const card = page.getByRole("article").filter({ hasText: name });
  await expect(card.getByRole("heading", { name })).toBeVisible();
  await expect(card).toContainText("每隔 3 天");
  await expect(card).toContainText("下一次预计右侧");

  await card.getByRole("button", { name: "执行记录" }).click();
  const recordDialog = page.getByRole("dialog", { name: `${name} · 执行记录` });
  await recordDialog.getByRole("button", { name: "右侧" }).click();
  await recordDialog.getByRole("button", { name: "保存记录" }).click();
  await expect(recordDialog).toContainText("执行记录已保存");
  await recordDialog.getByRole("button", { name: "关闭" }).click();
  await expect(card).toContainText("下一次预计左侧");

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("heading", { name })).toHaveCount(0);
});

test("records pregnancy weight and renders the growth curve", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("管理令牌").fill("local-admin-token-at-least-16");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "体重" }).click();
  await expect(page.getByRole("heading", { name: "体重记录" })).toBeVisible();

  const projectOffset = testInfo.project.name === "mobile" ? 32 : 30;
  const dates = [projectOffset, projectOffset - 1].map((offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10));
  for (const date of dates) {
    const existing = page.locator(`.weight-record-row:has(time[datetime="${date}"])`);
    if (await existing.count()) {
      page.once("dialog", (dialog) => dialog.accept());
      await existing.getByRole("button", { name: `删除 ${date} 体重` }).click();
      await expect(existing).toHaveCount(0);
    }
  }

  for (const [index, date] of dates.entries()) {
    await page.getByRole("button", { name: "记录体重" }).click();
    const dialog = page.getByRole("dialog", { name: "记录体重" });
    await dialog.getByLabel("测量日期").fill(date);
    await dialog.getByLabel("体重（kg）").fill(index === 0 ? "62.4" : "63.1");
    await dialog.getByLabel("备注").fill(index === 0 ? "晨起空腹" : "产检测量");
    await dialog.getByRole("button", { name: "保存" }).click();
  }

  await expect(page.getByRole("img", { name: "孕期体重增长折线图" })).toBeVisible();
  await expect(page.locator(`time[datetime="${dates[1]}"]`)).toBeVisible();
  await expect(page.locator(".weight-summary")).toContainText("+0.7 kg");
  await page.screenshot({ path: `../test-results/${testInfo.project.name}-weights.png`, fullPage: true });

  for (const date of [...dates].reverse()) {
    const row = page.locator(`.weight-record-row:has(time[datetime="${date}"])`);
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: `删除 ${date} 体重` }).click();
    await expect(row).toHaveCount(0);
  }
});

test("creates and removes a visit question", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("管理令牌").fill("local-admin-token-at-least-16");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("link", { name: "医嘱" }).click();
  await expect(page.getByRole("heading", { name: "医嘱与问题" })).toBeVisible();
  await page.getByRole("tab", { name: "就诊问题" }).click();
  await page.getByRole("button", { name: "新增" }).click();

  const content = `页面问题测试-${testInfo.project.name}`;
  const dialog = page.getByRole("dialog", { name: "新增问题" });
  await dialog.getByRole("textbox", { name: "问题" }).fill(content);
  await dialog.getByRole("textbox", { name: "回答记录" }).fill("医生回复后记录在这里");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: content })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("article").filter({ hasText: content }).getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("heading", { name: content })).toHaveCount(0);
});
