// موجه البرامج الذكي — Netlify Function v3
const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log("API Key present:", !!apiKey);
  console.log("API Key prefix:", apiKey ? apiKey.substring(0, 15) : "NONE");

  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "مفتاح API غير مهيأ على الخادم" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "طلب غير صالح: " + e.message }) }; }

  const { image, mediaType } = body;
  if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: "الصورة مفقودة" }) };

  // Log image size for debugging
  const imageSizeKB = Math.round(image.length * 0.75 / 1024);
  console.log("Image size KB:", imageSizeKB);
  console.log("Media type:", mediaType);

  // Allow up to 20MB base64 (15MB actual)
  if (image.length > 20000000) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: "الصورة كبيرة جداً — يرجى استخدام صورة أصغر" }) };
  }

  const prompt = `أنت خبير في قراءة وثائق الثانوية العامة العُمانية.

استخرج من هذه الصورة/الجدول جميع البيانات التالية بدقة تامة:

جدول مطابقة أسماء المواد بأكوادها:
التربية الإسلامية → تربية_اسلامية
اللغة العربية → عربي
اللغة الإنجليزية → انجليزي
الدراسات الاجتماعية / التربية الوطنية → دراسات_اجتماعية
الرياضيات المتقدمة → رياضيات_متقدمة
الرياضيات الأساسية → رياضيات_اساسية
الفيزياء → فيزياء
الكيمياء → كيمياء
الأحياء → احياء
تقنية المعلومات → تقنية_معلومات
الجغرافيا → جغرافيا
التاريخ → تاريخ
العلوم والتقانة → علوم_تقانة
الفنون التشكيلية → فنون_تشكيلية
المهارات الموسيقية → موسيقى
الرياضة المدرسية → رياضة
إدارة الأعمال → ادارة_اعمال
اللغة الفرنسية → فرنسي

أعد JSON فقط:
{
  "name": "الاسم الكامل أو null",
  "gender": "ذكر أو أنثى أو null",
  "grades": {
    "كود_المادة": {"f1": رقم, "f2": رقم}
  },
  "math_type": "رياضيات_متقدمة أو رياضيات_اساسية أو null",
  "electives": ["كود1","كود2","كود3"],
  "confidence": "high أو medium أو low"
}`;

  const requestBody = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
        { type: "text", text: prompt }
      ]
    }]
  });

  console.log("Sending to Anthropic, request size KB:", Math.round(requestBody.length / 1024));

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
      },
      timeout: 25000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log("Anthropic status:", res.statusCode);
        console.log("Response length:", data.length);

        if (res.statusCode !== 200) {
          console.error("Anthropic error body:", data.substring(0, 500));
          resolve({ statusCode: 502, headers,
            body: JSON.stringify({ error: "خطأ من خدمة الذكاء الاصطناعي (" + res.statusCode + "): " + data.substring(0, 200) }) });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || []).filter(b => b.type === "text").map(b => b.text).join("");
          console.log("AI response preview:", text.substring(0, 300));

          const match = text.match(/\{[\s\S]*\}/);
          if (!match) {
            resolve({ statusCode: 422, headers,
              body: JSON.stringify({ error: "لم أتمكن من قراءة الشهادة — تأكد من وضوح الصورة" }) });
            return;
          }

          const result = JSON.parse(match[0]);
          if (result.grades) {
            Object.keys(result.grades).forEach(k => {
              const g = result.grades[k];
              if (!g || g.f1 == null || g.f2 == null) delete result.grades[k];
            });
          }

          console.log("Success — grades extracted:", Object.keys(result.grades || {}).length);
          resolve({ statusCode: 200, headers, body: JSON.stringify(result) });

        } catch(e) {
          console.error("Parse error:", e.message, "Raw:", data.substring(0, 300));
          resolve({ statusCode: 500, headers,
            body: JSON.stringify({ error: "خطأ في المعالجة: " + e.message }) });
        }
      });
    });

    req.on('timeout', () => {
      console.error("Request timed out");
      req.destroy();
      resolve({ statusCode: 504, headers,
        body: JSON.stringify({ error: "انتهت مهلة الاتصال — حاول مجدداً" }) });
    });

    req.on('error', e => {
      console.error("Request error:", e.message);
      resolve({ statusCode: 500, headers,
        body: JSON.stringify({ error: "خطأ في الشبكة: " + e.message }) });
    });

    req.write(requestBody);
    req.end();
  });
};
