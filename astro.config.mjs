import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// gdlc (github-sdlc-plugins) marketplace documentation site — Astro +
// Starlight, modeled on the org's claude-code-plugins site (same versions,
// same mif-brand wiring, same docs/ symlink). Deployed to project Pages at
// /gdlc. Unlike claude-code-plugins, this site also renders each plugin's
// own Diataxis doc tree (docs/github-<plugin>/) into the sidebar.
export default defineConfig({
  site: "https://modeled-information-format.github.io",
  base: "/gdlc",
  integrations: [
    starlight({
      title: "gdlc",
      customCss: ["./src/styles/mif-brand.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://modeled-information-format.github.io/gdlc/og-image.png",
          },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:width", content: "1280" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:height", content: "640" },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://modeled-information-format.github.io/gdlc/og-image.png",
          },
        },
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/modeled-information-format/gdlc",
        },
      ],
      sidebar: [
        { label: "How-to guides", items: [{ autogenerate: { directory: "how-to" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
        { label: "Explanation", items: [{ autogenerate: { directory: "explanation" } }] },
        { label: "Security", items: [{ autogenerate: { directory: "security" } }] },
        { label: "Decisions (ADRs)", items: [{ autogenerate: { directory: "decisions" } }] },
        {
          label: "Plugins",
          items: [
            {
              label: "github-sdlc-planning",
              items: [
                { autogenerate: { directory: "github-sdlc-planning/tutorials" } },
                { autogenerate: { directory: "github-sdlc-planning/how-to" } },
                { autogenerate: { directory: "github-sdlc-planning/reference" } },
                { autogenerate: { directory: "github-sdlc-planning/explanation" } },
              ],
            },
            {
              label: "github-pull-requests",
              items: [
                { autogenerate: { directory: "github-pull-requests/tutorials" } },
                { autogenerate: { directory: "github-pull-requests/how-to" } },
                { autogenerate: { directory: "github-pull-requests/reference" } },
                { autogenerate: { directory: "github-pull-requests/explanation" } },
              ],
            },
            {
              label: "github-bug-capture",
              items: [
                { autogenerate: { directory: "github-bug-capture/tutorials" } },
                { autogenerate: { directory: "github-bug-capture/how-to" } },
                { autogenerate: { directory: "github-bug-capture/reference" } },
                { autogenerate: { directory: "github-bug-capture/explanation" } },
              ],
            },
            {
              label: "github-repo-config",
              items: [
                { autogenerate: { directory: "github-repo-config/tutorials" } },
                { autogenerate: { directory: "github-repo-config/how-to" } },
                { autogenerate: { directory: "github-repo-config/reference" } },
                { autogenerate: { directory: "github-repo-config/explanation" } },
              ],
            },
            {
              label: "github-insights",
              items: [
                { autogenerate: { directory: "github-insights/tutorials" } },
                { autogenerate: { directory: "github-insights/how-to" } },
                { autogenerate: { directory: "github-insights/reference" } },
                { autogenerate: { directory: "github-insights/explanation" } },
              ],
            },
            {
              label: "github-packages",
              items: [
                { autogenerate: { directory: "github-packages/tutorials" } },
                { autogenerate: { directory: "github-packages/how-to" } },
                { autogenerate: { directory: "github-packages/reference" } },
                { autogenerate: { directory: "github-packages/explanation" } },
              ],
            },
            {
              label: "github-org-identity",
              items: [
                { autogenerate: { directory: "github-org-identity/tutorials" } },
                { autogenerate: { directory: "github-org-identity/how-to" } },
                { autogenerate: { directory: "github-org-identity/reference" } },
                { autogenerate: { directory: "github-org-identity/explanation" } },
              ],
            },
          ],
        },
        {
          label: "MIF ecosystem",
          items: [
            { label: "MIF home", link: "https://modeled-information-format.github.io/" },
            { label: "Ecosystem docs", link: "https://modeled-information-format.github.io/docs/" },
            { label: "Plugin marketplaces", link: "https://modeled-information-format.github.io/claude-code-plugins/" },
            { label: "Specification (mif-spec.dev)", link: "https://mif-spec.dev" },
          ],
        },
      ],
    }),
  ],
});
