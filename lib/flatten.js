// Flatten an image with transparency onto mid-grey, so white marks and black marks
// both stay visible. sips flattens onto white, which erased every white-on-transparent
// logo (found 2026-09-23: Spotify, Sprite, Gillette...). Zero dependencies: macOS JXA +
// Core Image (an AppKit drawing context rendered nothing under osascript).
//
//   osascript -l JavaScript flatten.js <src> <dst.png>
ObjC.import("CoreImage");
ObjC.import("CoreGraphics");

function run(argv) {
  const [src, dst] = argv;
  const im = $.CIImage.imageWithContentsOfURL($.NSURL.fileURLWithPath(src));
  if (!im || im.isNil()) throw new Error(`cannot read ${src}`);
  const grey = $.CIImage.imageWithColor($.CIColor.colorWithRedGreenBlue(0.5, 0.5, 0.5)).imageByCroppingToRect(im.extent);
  const flat = im.imageByCompositingOverImage(grey);
  const cs = $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB);
  const ok = $.CIContext.context.writePNGRepresentationOfImageToURLFormatColorSpaceOptionsError(
    flat, $.NSURL.fileURLWithPath(dst), $.kCIFormatRGBA8, cs, $({}), null);
  if (!ok) throw new Error(`cannot write ${dst}`);
  return "ok";
}
