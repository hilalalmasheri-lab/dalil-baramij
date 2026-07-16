// موجه البرامج الذكي — Netlify Function
// Proxy آمن لاستدعاء Anthropic API لقراءة شهادات الثانوية العُمانية

exports.handler = async function(event, context) {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // API key from Netlify environment variables
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: "مفتاح API غير مهيأ على الخادم" })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "طلب غير صالح" }) };
  }

  const { image, mediaType } = body;
  if (!image || !mediaType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "بيانات الصورة مفقودة" }) };
  }

  // Validate image size (max ~4MB base64)
  if (image.length > 6_000_000) {
    return {
      statusCode: 413, headers,
      body: JSON.stringify({ error: "الصورة كبيرة جداً — يرجى استخدام صورة أصغر (أقل من 4MB)" })
    };
  }

  const prompt = `أنت متخصص في قراءة شهادات الثانوية العامة العُمانية (دبلوم التعليم العام).

استخرج من هذه الشهادة بدقة:
1. اسم الطالب/الطالبة الكامل
2. الجنس (ذكر أو أنثى)
3. درجات كل مادة: درجة الفصل الأول ودرجة الفصل الثاني بشكل منفصل

أكواد المواد الممكنة:
تربية_اسلامية | عربي | انجليزي | دراسات_اجتماعية
رياضيات_متقدمة | رياضيات_اساسية | فيزياء | كيمياء | احياء
تقنية_معلومات | جغرافيا | تاريخ | علوم_تقانة
انجليزي_متقدم | فنون_تشكيلية | موسيقى | رياضة | ادارة_اعمال | فرنسي

أعد JSON فقط بلا أي نص آخر:
{
  "name": "الاسم الكامل",
  "gender": "ذكر أو أنثى",
  "grades": {
    "تربية_اسلامية": {"f1": 95, "f2": 97},
    "عربي": {"f1": 88, "f2": 90}
  },
  "math_type": "رياضيات_متقدمة أو رياضيات_اساسية",
  "electives": ["كود1", "كود2", "كود3"],
  "confidence": "high أو medium أو low"
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return {
        statusCode: 502, headers,
        body: JSON.stringify({ error: "خطأ في الاتصال بخدمة الذكاء الاصطناعي" })
      };
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        statusCode: 422, headers,
        body: JSON.stringify({ error: "لم أتمكن من قراءة الشهادة — تأكد من وضوح الصورة" })
      };
    }

    const parsed = JSON.parse(match[0]);
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: "خطأ داخلي: " + err.message })
    };
  }
};
