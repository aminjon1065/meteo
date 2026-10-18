import { describe, expect, it } from "vitest";
import { markdownExcerpt, markdownToText, renderMarkdown } from "../markdown";

describe("renderMarkdown: блоки", () => {
  it("заголовки сдвигаются на уровень вниз и не глубже h6", () => {
    expect(renderMarkdown("# Заголовок")).toBe("<h2>Заголовок</h2>");
    expect(renderMarkdown("## Подзаголовок ##")).toBe("<h3>Подзаголовок</h3>");
    expect(renderMarkdown("##### Пятый")).toBe("<h6>Пятый</h6>");
    expect(renderMarkdown("###### Шестой")).toBe("<h6>Шестой</h6>");
    expect(renderMarkdown("#хэштег")).toBe("<p>#хэштег</p>");
    expect(renderMarkdown("####### семь")).toBe("<p>####### семь</p>");
  });

  it("абзацы, мягкие и жёсткие переносы", () => {
    expect(renderMarkdown("Первая строка\nвторая строка\n\nВторой абзац")).toBe(
      "<p>Первая строка\nвторая строка</p><p>Второй абзац</p>",
    );
    expect(renderMarkdown("раз  \nдва")).toBe("<p>раз<br>два</p>");
    expect(renderMarkdown("раз\\\nдва")).toBe("<p>раз<br>два</p>");
    expect(renderMarkdown("раз \nдва")).toBe("<p>раз\nдва</p>");
    expect(renderMarkdown("\n\n   текст   \n\n\n")).toBe("<p>текст</p>");
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("списки: маркированные, нумерованные, вложенные", () => {
    expect(renderMarkdown("- один\n- два\n  - вложенный\n  - ещё\n- три")).toBe(
      "<ul><li>один</li><li>два<ul><li>вложенный</li><li>ещё</li></ul></li><li>три</li></ul>",
    );
    expect(renderMarkdown("1. раз\n2. два")).toBe("<ol><li>раз</li><li>два</li></ol>");
    expect(renderMarkdown("3. раз\n4. два")).toBe('<ol start="3"><li>раз</li><li>два</li></ol>');
    expect(renderMarkdown("* a\n* b\n+ c")).toBe(
      "<ul><li>a</li><li>b</li></ul><ul><li>c</li></ul>",
    );
    expect(renderMarkdown("- пункт\n   1. первый\n   2. второй")).toBe(
      "<ul><li>пункт<ol><li>первый</li><li>второй</li></ol></li></ul>",
    );
    expect(renderMarkdown("- a\n- b\n\nТекст после")).toBe(
      "<ul><li>a</li><li>b</li></ul><p>Текст после</p>",
    );
    expect(renderMarkdown("- **жирный** пункт\n  продолжение")).toBe(
      "<ul><li><strong>жирный</strong> пункт\nпродолжение</li></ul>",
    );
    expect(renderMarkdown("-не список")).toBe("<p>-не список</p>");
  });

  it("цитаты", () => {
    expect(renderMarkdown("> Цитата\n> **важно**")).toBe(
      "<blockquote><p>Цитата\n<strong>важно</strong></p></blockquote>",
    );
    expect(renderMarkdown("> a\n>\n> b")).toBe("<blockquote><p>a</p><p>b</p></blockquote>");
    expect(renderMarkdown("> a\n> - x\n> - y")).toBe(
      "<blockquote><p>a</p><ul><li>x</li><li>y</li></ul></blockquote>",
    );
  });

  it("огороженный код экранируется и не разбирается", () => {
    expect(renderMarkdown("```html\n<script>alert(1)</script>\n**не жирный**\n```")).toBe(
      '<pre><code class="language-html">&lt;script&gt;alert(1)&lt;/script&gt;\n**не жирный**</code></pre>',
    );
    expect(renderMarkdown("```\na\n\nb\n```\nпосле")).toBe(
      "<pre><code>a\n\nb</code></pre><p>после</p>",
    );
    expect(renderMarkdown("~~~\nx\n~~~")).toBe("<pre><code>x</code></pre>");
    expect(renderMarkdown("```\nбез закрытия")).toBe("<pre><code>без закрытия</code></pre>");
  });

  it("горизонтальная линия", () => {
    expect(renderMarkdown("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
    expect(renderMarkdown("***")).toBe("<hr>");
    expect(renderMarkdown("- - -")).toBe("<hr>");
  });
});

describe("renderMarkdown: строчная разметка", () => {
  it("жирный, курсив, зачёркнутый, код", () => {
    expect(renderMarkdown("**жирный** и *курсив*, _ещё_, ~~нет~~, `a < b`")).toBe(
      "<p><strong>жирный</strong> и <em>курсив</em>, <em>ещё</em>, <del>нет</del>, <code>a &lt; b</code></p>",
    );
    expect(renderMarkdown("**bold *em* bold**")).toBe(
      "<p><strong>bold <em>em</em> bold</strong></p>",
    );
    expect(renderMarkdown("*em **strong** em*")).toBe(
      "<p><em>em <strong>strong</strong> em</em></p>",
    );
    expect(renderMarkdown("***оба***")).toBe("<p><em><strong>оба</strong></em></p>");
    expect(renderMarkdown("snake_case_name и 2 * 3 * 4")).toBe(
      "<p>snake_case_name и 2 * 3 * 4</p>",
    );
    expect(renderMarkdown("\\*не курсив\\* и \\# не заголовок")).toBe(
      "<p>*не курсив* и # не заголовок</p>",
    );
    expect(renderMarkdown("`` код с ` внутри ``")).toBe("<p><code>код с ` внутри</code></p>");
    expect(renderMarkdown("`незакрытый код")).toBe("<p>`незакрытый код</p>");
  });

  it("ссылки: внешние, внутренние, с title", () => {
    expect(renderMarkdown("[Сайт](https://example.com)")).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">Сайт</a></p>',
    );
    expect(renderMarkdown("[Прогноз](/forecast/dushanbe)")).toBe(
      '<p><a href="/forecast/dushanbe">Прогноз</a></p>',
    );
    expect(renderMarkdown('[x](https://e.com "Заголовок")')).toBe(
      '<p><a href="https://e.com" title="Заголовок" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(renderMarkdown("[Почта](mailto:info@example.com)")).toBe(
      '<p><a href="mailto:info@example.com">Почта</a></p>',
    );
    expect(renderMarkdown("[a](#section) [b](./a) [c](../b)")).toBe(
      '<p><a href="#section">a</a> <a href="./a">b</a> <a href="../b">c</a></p>',
    );
    expect(renderMarkdown("[x](https://e.com/?a=1&b=2)")).toBe(
      '<p><a href="https://e.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(renderMarkdown("[**жирная** ссылка](/x)")).toBe(
      '<p><a href="/x"><strong>жирная</strong> ссылка</a></p>',
    );
    expect(renderMarkdown("[не ссылка] и [тоже](")).toBe("<p>[не ссылка] и [тоже](</p>");
  });

  it("изображения", () => {
    expect(renderMarkdown("![Карта](/img/map.png)")).toBe(
      '<p><img src="/img/map.png" alt="Карта"></p>',
    );
    expect(renderMarkdown('Фото: ![a *b*](https://x/y.png "T")')).toBe(
      '<p>Фото: <img src="https://x/y.png" alt="a b" title="T"></p>',
    );
  });

  it("автоссылки", () => {
    expect(renderMarkdown("<https://example.com/p?a=1&b=2>")).toBe(
      '<p><a href="https://example.com/p?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://example.com/p?a=1&amp;b=2</a></p>',
    );
    expect(renderMarkdown("<info@example.com>")).toBe(
      '<p><a href="mailto:info@example.com">info@example.com</a></p>',
    );
  });

  it("XSS: опасные схемы отбрасываются, HTML экранируется", () => {
    expect(renderMarkdown("[click](javascript:alert(1))")).toBe("<p>click</p>");
    expect(
      renderMarkdown("[x](JavaScript:alert(1)) [y](vbscript:x) [z](data:text/html;base64,AA)"),
    ).toBe("<p>x y z</p>");
    expect(renderMarkdown("[x](<java\tscript:alert(1)>)")).toBe("<p>x</p>");
    expect(renderMarkdown("[x](//evil.com) [y](/\\evil.com)")).toBe("<p>x y</p>");
    const img = renderMarkdown("![x](data:image/svg+xml;base64,AAAA) текст");
    expect(img).not.toContain("<img");
    expect(img).not.toContain("data:");
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>",
    );
    expect(renderMarkdown('<script>alert("x")</script>')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
    expect(renderMarkdown('[x](/a "t\\" onmouseover=\\"alert(1)")')).toBe(
      '<p><a href="/a" title="t&quot; onmouseover=&quot;alert(1)">x</a></p>',
    );
    expect(renderMarkdown("Tom & Jerry 'q' <b>")).toBe(
      "<p>Tom &amp; Jerry &#39;q&#39; &lt;b&gt;</p>",
    );
    expect(renderMarkdown("```\n</code></pre><script>\n```")).toBe(
      "<pre><code>&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;</code></pre>",
    );
  });
});

describe("markdownToText", () => {
  it("снимает разметку, сохраняет URL и строки списков", () => {
    const src = [
      "# Заголовок",
      "",
      "Абзац с **жирным** и [ссылкой](https://example.com).",
      "Перенос  ",
      "строки и <https://auto.link> и ![картинка](/i.png).",
      "",
      "",
      "",
      "- один",
      "- два",
      "  - вложенный",
      "",
      "1. раз",
      "2. два",
      "",
      "> цитата",
      "",
      "---",
      "",
      "```",
      "код <b>",
      "```",
    ].join("\n");
    expect(markdownToText(src)).toBe(
      [
        "Заголовок",
        "",
        "Абзац с жирным и ссылкой (https://example.com).",
        "Перенос",
        "строки и https://auto.link и картинка.",
        "",
        "- один",
        "- два",
        "  - вложенный",
        "",
        "1. раз",
        "2. два",
        "",
        "цитата",
        "",
        "код <b>",
      ].join("\n"),
    );
    expect(markdownToText("[x](javascript:alert(1))")).toBe("x");
    expect(markdownToText("")).toBe("");
  });
});

describe("markdownExcerpt", () => {
  it("берёт первые абзацы, пропуская заголовки", () => {
    expect(markdownExcerpt("# Т\n\nКороткий абзац.\n\nВторой.")).toBe("Короткий абзац. Второй.");
    expect(markdownExcerpt("Первый абзац.\n\nВторой очень длинный абзац", 20)).toBe(
      "Первый абзац.",
    );
    expect(markdownExcerpt("Строка один\nстрока два")).toBe("Строка один строка два");
  });

  it("режет по границе слова с многоточием", () => {
    const long = "слово ".repeat(60).trim();
    const ex = markdownExcerpt(`# Заголовок\n\n${long}`);
    expect(ex.length).toBeLessThanOrEqual(200);
    expect(ex).toBe(`${"слово ".repeat(33).trim()}…`);
    expect(markdownExcerpt("Температура воздуха, ветер слабый", 22)).toBe("Температура воздуха…");
    expect(markdownExcerpt("абвгдежзийклмнопрст", 10)).toBe("абвгдежзи…");
  });
});
