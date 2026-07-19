// موجه البرامج الذكي — Netlify Function
const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  // Debug: log what we see
  console.log("API Key present:", !!apiKey);
  console.log("API Key length:", apiKey ? apiKey.length : 0);
  console.log("API Key prefix:", apiKey ? apiKey.substring(0, 15) : "NONE");

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

  if (image.length > 6000000) {
    return {
      statusCode: 413, headers,
      body: JSON.stringify({ error: "الصورة كبيرة جداً — يرجى استخدام صورة أصغر" })
    };
  }

  const prompt = `أنت متخصص في قراءة شهادات الثانوية العامة العُمانية.
استخرج من هذه الشهادة:
1. اسم الطالب/الطالبة الكامل
2. الجنس (ذكر أو أنثى)
3. درجات كل مادة: درجة الفصل الأول ودرجة الفصل الثاني

أكواد المواد:
تربية_اسلامية | عربي | انجليزي | دراسات_اجتماعية
رياضيات_متقدمة | رياضيات_اساسية | فيزياء | كيمياء | احياء
تقنية_معلومات | جغرافيا | تاريخ | علوم_تقانة
انجليزي_متقدم | فنون_تشكيلية | موسيقى | رياضة | ادارة_اعمال | فرنسي

أعد JSON فقط:
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

  const requestBody = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: prompt }
      ]
    }]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log("Anthropic status:", res.statusCode);
        if (res.statusCode !== 200) {
          console.error("Anthropic error:", data);
          resolve({
            statusCode: 502, headers,
            body: JSON.stringify({ error: "خطأ في الاتصال: " + res.statusCode })
          });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || [])
            .filter(b => b.type === "text")
            .map(b => b.text)
            .join("");
          const match = text.match(/\{[\s\S]*\}/);
          if (!match) {
            resolve({ statusCode: 422, headers, body: JSON.stringify({ error: "لم أتمكن من قراءة الشهادة" }) });
            return;
          }
          const result = JSON.parse(match[0]);
          resolve({ statusCode: 200, headers, body: JSON.stringify(result) });
        } catch (e) {
          resolve({ statusCode: 500, headers, body: JSON.stringify({ error: "خطأ في المعالجة: " + e.message }) });
        }
      });
    });

    req.on('error', (e) => {
      console.error("Request error:", e);
      resolve({ statusCode: 500, headers, body: JSON.stringify({ error: "خطأ في الشبكة: " + e.message }) });
    });

    req.write(requestBody);
    req.end();
  });
};
