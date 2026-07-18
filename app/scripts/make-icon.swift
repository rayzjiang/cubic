// Regenerate app/build-resources/icon.icns from the white-cube SVG, drawn CENTERED on a black rounded
// square. Pure macOS (CoreGraphics + ImageIO + iconutil) — no Homebrew deps. Run: `npm run icon`.
//
// Tweakables (eyeball the preview, then adjust): BG darkness, CORNER_RATIO, CUBE_SCALE, V_NUDGE.
//   CUBE_SCALE — cube size as a fraction of the canvas. V_NUDGE — extra vertical shift in canvas
//   fractions (0 = mathematically centered; +down / -up) for optical tweaks.

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// ── knobs ─────────────────────────────────────────────────────────────────────
let BG = CGColor(red: 0.086, green: 0.086, blue: 0.094, alpha: 1)   // near-black square
let CUBE = CGColor(red: 0.996, green: 1.0, blue: 0.996, alpha: 1)    // #fefffe white cube
let CORNER_RATIO: CGFloat = 0.2237   // Apple-ish squircle radius (× side)
let CUBE_SCALE: CGFloat = 0.70       // cube fits this fraction of the side (longest axis)
let V_NUDGE: CGFloat = 0.0           // vertical optical nudge, fraction of side (+down)
let FILL_EVEN_ODD = false            // SVG default is nonzero; flip to true if the cube fills solid
// ──────────────────────────────────────────────────────────────────────────────

// app/ — resolved from this script's own path (app/scripts/make-icon.swift), cwd-independent.
let appDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let svgURL = appDir.appendingPathComponent("src/renderer/src/assets/cubic-logo.svg")
let outIcns = appDir.appendingPathComponent("build-resources/icon.icns")
let previewURL = appDir.appendingPathComponent("build-resources/icon-preview.png")

// ── extract the path `d` from the SVG ───────────────────────────────────────────
guard let svg = try? String(contentsOf: svgURL, encoding: .utf8),
      let dRange = svg.range(of: #"\sd="([^"]*)""#, options: .regularExpression) else {
    FileHandle.standardError.write("make-icon: couldn't read a path from \(svgURL.path)\n".data(using: .utf8)!)
    exit(1)
}
let dAttr = String(svg[dRange]).replacingOccurrences(of: #"\sd=""#, with: "", options: .regularExpression)
let d = String(dAttr.dropLast()) // trailing quote

// ── minimal SVG path parser (M m L l H h V v C c S s Z z) → CGPath in SVG (y-down) space ──
func parsePath(_ s: String) -> CGPath {
    let path = CGMutablePath()
    var nums = [CGFloat]()
    var i = s.startIndex
    var tokens = [(cmd: Character, args: [CGFloat])]()
    func flush(_ cmd: Character) { tokens.append((cmd, nums)); nums.removeAll() }
    var cur: Character = " "
    while i < s.endIndex {
        let c = s[i]
        if c.isLetter {
            if cur != " " { flush(cur) }
            cur = c
            i = s.index(after: i)
        } else if c == "-" || c == "+" || c == "." || c.isNumber {
            // read a number (handles leading -, decimals, and exponent-free floats + sign as delimiter)
            var j = i
            var seenDot = false
            if s[j] == "-" || s[j] == "+" { j = s.index(after: j) }
            while j < s.endIndex {
                let cj = s[j]
                if cj.isNumber { j = s.index(after: j) }
                else if cj == "." && !seenDot { seenDot = true; j = s.index(after: j) }
                else { break }
            }
            nums.append(CGFloat(Double(s[i..<j]) ?? 0))
            i = j
        } else { i = s.index(after: i) } // whitespace / comma
    }
    if cur != " " { flush(cur) }

    var pt = CGPoint.zero      // current point
    var start = CGPoint.zero   // subpath start
    var lastC = CGPoint.zero   // last cubic control (for S/s)
    for (cmd, a) in tokens {
        switch cmd {
        case "M", "m":
            let rel = cmd == "m"
            var k = 0
            while k + 1 < a.count {
                let p = CGPoint(x: (rel ? pt.x : 0) + a[k], y: (rel ? pt.y : 0) + a[k+1])
                if k == 0 { path.move(to: p); start = p } else { path.addLine(to: p) }
                pt = p; k += 2
            }
        case "L", "l":
            let rel = cmd == "l"; var k = 0
            while k + 1 < a.count { let p = CGPoint(x: (rel ? pt.x : 0)+a[k], y: (rel ? pt.y : 0)+a[k+1]); path.addLine(to: p); pt = p; k += 2 }
        case "H", "h":
            let rel = cmd == "h"; for v in a { let p = CGPoint(x: (rel ? pt.x : 0)+v, y: pt.y); path.addLine(to: p); pt = p }
        case "V", "v":
            let rel = cmd == "v"; for v in a { let p = CGPoint(x: pt.x, y: (rel ? pt.y : 0)+v); path.addLine(to: p); pt = p }
        case "C", "c":
            let rel = cmd == "c"; var k = 0
            while k + 5 < a.count {
                let bx = rel ? pt.x : 0, by = rel ? pt.y : 0
                let c1 = CGPoint(x: bx+a[k], y: by+a[k+1]), c2 = CGPoint(x: bx+a[k+2], y: by+a[k+3]), e = CGPoint(x: bx+a[k+4], y: by+a[k+5])
                path.addCurve(to: e, control1: c1, control2: c2); lastC = c2; pt = e; k += 6
            }
        case "S", "s":
            let rel = cmd == "s"; var k = 0
            while k + 3 < a.count {
                let bx = rel ? pt.x : 0, by = rel ? pt.y : 0
                let c1 = CGPoint(x: 2*pt.x - lastC.x, y: 2*pt.y - lastC.y)
                let c2 = CGPoint(x: bx+a[k], y: by+a[k+1]), e = CGPoint(x: bx+a[k+2], y: by+a[k+3])
                path.addCurve(to: e, control1: c1, control2: c2); lastC = c2; pt = e; k += 4
            }
        case "Z", "z":
            path.closeSubpath(); pt = start
        default: break
        }
    }
    return path
}

let cube = parsePath(d)
let bbox = cube.boundingBoxOfPath

// ── render one square PNG at pixel size `S` ─────────────────────────────────────
func render(_ S: Int) -> CGImage {
    let side = CGFloat(S)
    let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    // top-left origin (SVG-like) so the parsed y-down path draws upright
    ctx.translateBy(x: 0, y: side); ctx.scaleBy(x: 1, y: -1)

    // black rounded square, full-bleed (transparent corners)
    let r = CORNER_RATIO * side
    ctx.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: side, height: side), cornerWidth: r, cornerHeight: r, transform: nil))
    ctx.setFillColor(BG); ctx.fillPath()

    // center the cube: fit its longest axis to CUBE_SCALE, then center both axes (+ optional nudge)
    let target = CUBE_SCALE * side
    let scale = target / max(bbox.width, bbox.height)
    let originX = (side - bbox.width * scale) / 2
    let originY = (side - bbox.height * scale) / 2 + V_NUDGE * side
    var t = CGAffineTransform(translationX: originX, y: originY).scaledBy(x: scale, y: scale).translatedBy(x: -bbox.minX, y: -bbox.minY)
    ctx.addPath(cube.copy(using: &t)!)
    ctx.setFillColor(CUBE)
    ctx.fillPath(using: FILL_EVEN_ODD ? .evenOdd : .winding)

    return ctx.makeImage()!
}

func writePNG(_ img: CGImage, _ url: URL) {
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil)
    CGImageDestinationFinalize(dest)
}

// ── build the .iconset, then iconutil → .icns ───────────────────────────────────
let tmp = appDir.appendingPathComponent("build-resources/icon.iconset")
try? FileManager.default.removeItem(at: tmp)
try! FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
let entries: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
var cache = [Int: CGImage]()
for (name, px) in entries {
    let img = cache[px] ?? render(px); cache[px] = img
    writePNG(img, tmp.appendingPathComponent("\(name).png"))
}
writePNG(cache[1024]!, previewURL) // full-res preview to eyeball centering

let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", tmp.path, "-o", outIcns.path]
try! p.run(); p.waitUntilExit()
try? FileManager.default.removeItem(at: tmp)

print("make-icon: wrote \(outIcns.path)")
print("make-icon: preview \(previewURL.path)  (cube bbox in svg space: \(bbox))")
