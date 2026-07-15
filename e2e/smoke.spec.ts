import { expect, test } from "@playwright/test";

test("create a task and watch the simulated run complete", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await page.getByPlaceholder("What would you like to work on?").fill("Add a Button component");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("heading", { name: "Add a Button component" })).toBeVisible();

  // The Plan & Progress panel renders the simulated todo list.
  await expect(page.getByText("Read ticket context and .forge knowledge")).toBeVisible();
  await expect(page.getByText("Run quality gates")).toBeVisible();

  // The run completes: all todos done, gates passed, terminal state shown.
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("5/5 steps done")).toBeVisible();
  const planPanel = page.getByRole("region", { name: "Plan and progress" });
  await expect(planPanel.getByText("test: passed")).toBeVisible();

  // The sidebar regroups the finished task under Review.
  const sidebar = page.getByRole("navigation", { name: "Tasks" });
  await expect(sidebar.getByText("Review (1)")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Add a Button component" })).toBeVisible();
});

test("the run replays for a revisit after completion", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("What would you like to work on?").fill("Fix the tooltip");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 20_000 });

  // Navigate away and back; the SSE replay rebuilds the finished panel.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("link", { name: "Fix the tooltip" })
    .click();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5/5 steps done")).toBeVisible();
});
