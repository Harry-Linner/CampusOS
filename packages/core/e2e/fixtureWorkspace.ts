import { expect, type Page } from "@playwright/test";

/** Fixture setup for tests of an already configured workspace, not an auth bypass in the app. */
export const prepareFixtureWorkspace = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    await window.campusos.workspace.sync();
    const runtime = await window.campusos.plugins.load();
    for (const id of ["org.campusos.academic", "org.campusos.schedule", "org.campusos.materials", "org.campusos.ai-assistant"]) {
      const plugin = runtime.plugins.find(candidate => candidate.id === id);
      if (!plugin) throw new Error(`Missing fixture plugin: ${id}`);
      await window.campusos.plugins.configure({ pluginId: id, enabled: true, grantedPermissions: [...plugin.manifest.permissions] });
    }
    await window.campusos.lifecycle.save({ launchAtLogin: false, notificationEnabled: true, notificationPrompted: true });
    localStorage.setItem("campusos.onboarding.completed", "1");
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();
};
