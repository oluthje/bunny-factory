import { describe, expect, it } from "vitest";
import { linearUploadUrls, localizeUploads, MAX_UPLOADS, uploadPath, UPLOADS_DIR } from "../src/linear-uploads.ts";

const mockup = "https://uploads.linear.app/59c9/e010/19420a0a";
const shot = "https://uploads.linear.app/59c9/9820/5fa99ecd?signature=abc.def";
const description = `![dock-undock-mockup.png](${mockup})

updating the icons like in this mockup, see also <img src="${shot}"> and ${mockup} again`;

describe("linearUploadUrls", () => {
  it("lists each Linear upload once, in order, in Markdown, HTML or bare", () => {
    expect(linearUploadUrls(description)).toEqual([mockup, shot]);
  });

  it("stops at the end of a JSON string", () => {
    expect(linearUploadUrls(`{"src":"${mockup}","alt":"x"}`)).toEqual([mockup]);
  });

  it("ignores other hosts", () => {
    expect(linearUploadUrls("![logo](https://example.com/logo.png)")).toEqual([]);
  });

  it("caps how many a run gets", () => {
    const many = Array.from({ length: MAX_UPLOADS + 5 }, (_, i) => `${mockup}${i}`).join(" ");
    expect(linearUploadUrls(many)).toHaveLength(MAX_UPLOADS);
  });
});

describe("uploadPath", () => {
  it("takes the extension from the content type", () => {
    expect(uploadPath(1, "image/png")).toBe(`${UPLOADS_DIR}/1.png`);
    expect(uploadPath(2, "image/jpeg; charset=binary")).toBe(`${UPLOADS_DIR}/2.jpg`);
    expect(uploadPath(3, null)).toBe(`${UPLOADS_DIR}/3.bin`);
  });
});

describe("localizeUploads", () => {
  it("points each downloaded upload at its runner path, every time it's linked", () => {
    const out = localizeUploads(description, { [mockup]: `${UPLOADS_DIR}/1.png` });
    expect(out).toContain(`![dock-undock-mockup.png](${UPLOADS_DIR}/1.png)`);
    expect(out).toContain(`and ${UPLOADS_DIR}/1.png again`);
    expect(out).not.toContain(mockup);
  });

  it("leaves an upload that wasn't downloaded as a link", () => {
    expect(localizeUploads(description, {})).toBe(description);
  });
});
