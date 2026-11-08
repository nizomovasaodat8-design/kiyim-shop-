# demo.src.html → demo.html: shriftlar va rasmlarni base64 qilib ichiga joylaydi (o'zi yetarli bitta fayl)
import base64, re, pathlib, mimetypes

here = pathlib.Path(__file__).parent
root = here.parent
src = (here / "demo.src.html").read_text(encoding="utf-8")

def data_uri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()

src = re.sub(r"%%FONT:([\w.-]+)%%", lambda m: data_uri(here / "fonts" / m.group(1), "font/woff2"), src)
src = re.sub(r"%%IMG:([\w./-]+)%%", lambda m: data_uri(root / m.group(1), mimetypes.guess_type(m.group(1))[0] or "image/webp"), src)
(here / "demo.html").write_text(src, encoding="utf-8")
print("demo.html", round(len(src) / 1024), "KB")
