// موجه البرامج الذكي — Netlify Function v4
// يدعم شهادة وزارة التعليم الجديدة 2026 (نسبة مباشرة بدون فصلين)
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

  const imageSizeKB = Math.round(image.length * 0.75 / 1024);
  console.log("Image size KB:", imageSizeKB, "| Type:", mediaType);

  if (image.length > 20000000) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: "الصورة كبيرة جداً — استخدم صورة أصغر" }) };
  }

  const prompt = `أنت خبير في قراءة شهادات الثانوية العامة العُمانية الصادرة من وزارة التعليم عام 2026.

الشهادة الجديدة تُظهر لكل مادة: اسم المادة، التقدير (A/B/C/D)، والنسبة المئوية مباشرةً.
لا يوجد فصل أول وفصل ثانٍ منفصلَين — فقط نسبة واحدة لكل مادة.

استخرج من هذه الشهادة:
١. اسم الطالب/الطالبة الكامل
٢. الجنس (ذكر أو أنثى) إن ظهر
٣. النسبة المئوية لكل مادة

جدول مطابقة أسماء المواد:
التربية الإسلامية / الإسلامية → تربية_اسلامية
اللغة العربية / العربية → عربي
اللغة الإنجليزية / الإنجليزية / مهارات اللغة الإنجليزية → انجليزي
الدراسات الاجتماعية / التربية الوطنية → دراسات_اجتماعية
الرياضيات المتقدمة → رياضيات_متقدمة
الرياضيات الأساسية / الرياضيات → رياضيات_اساسية
الفيزياء → فيزياء
الكيمياء → كيمياء
الأحياء → احياء
تقنية المعلومات / الحاسب → تقنية_معلومات
الجغرافيا الاقتصادية / الجغرافيا → جغرافيا
التاريخ → تاريخ
العلوم والتقانة → علوم_تقانة
مهارات اللغة الإنجليزية / الإنجليزية المتقدمة → مهارات_انجليزي
الفنون التشكيلية → فنون_تشكيلية
المهارات الموسيقية → موسيقى
الرياضة المدرسية / التربية البدنية → رياضة
العلوم البيئية / البيئة → علوم_بيئية
إدارة الأعمال → ادارة_اعمال
اللغة الفرنسية → فرنسي

أعد JSON فقط بدون أي نص آخر:
{
  "name": "الاسم الكامل أو null",
  "gender": "ذكر أو أنثى أو null",
  "grades": {
    "كود_المادة": رقم_النسبة_المئوية
  },
  "math_type": "رياضيات_متقدمة أو رياضيات_اساسية أو null",
  "electives": ["كود1", "كود2", "كود3"],
  "confidence": "high أو medium أو low"
}

ملاحظة: لتحديد الجنس — انظر اسم الطالب. إذا الاسم أنثوي (فاطمة، مريم، عزة، سارة...) اكتب أنثى. إذا ذكوري (محمد، سالم، خالد...) اكتب ذكر.

مثال على grades:
"grades": {
  "تربية_اسلامية": 97,
  "عربي": 91,
  "انجليزي": 99,
  "دراسات_اجتماعية": 94,
  "رياضيات_متقدمة": 93,
  "فيزياء": 94,
  "كيمياء": 87,
  "موسيقى": 96
}`;

  const requestBody = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
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
        if (res.statusCode !== 200) {
          console.error("Anthropic error:", data.substring(0, 300));
          resolve({ statusCode: 502, headers,
            body: JSON.stringify({ error: "خطأ في خدمة الذكاء الاصطناعي (" + res.statusCode + ")" }) });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || []).filter(b => b.type === "text").map(b => b.text).join("");
          console.log("AI response preview:", text.substring(0, 200));

          const match = text.match(/\{[\s\S]*\}/);
          if (!match) {
            resolve({ statusCode: 422, headers,
              body: JSON.stringify({ error: "لم أتمكن من قراءة الشهادة — تأكد من وضوح الصورة" }) });
            return;
          }

          const result = JSON.parse(match[0]);

          // Normalize grades — handle both formats
          if (result.grades) {
            Object.keys(result.grades).forEach(k => {
              const v = result.grades[k];
              if (typeof v === 'object' && v !== null) {
                // Old format with f1/f2 — convert to single score
                const v1 = Number(v.f1 || 0), v2 = Number(v.f2 || 0);
                if (v1 > 0 && v2 > 0) result.grades[k] = +((v1+v2)/2).toFixed(2);
                else if (v1 > 0) result.grades[k] = v1;
                else if (v2 > 0) result.grades[k] = v2;
                else delete result.grades[k];
              } else {
                const n = Number(v);
                if (!n || n <= 0 || n > 100) delete result.grades[k];
                else result.grades[k] = n;
              }
            });
          }

          console.log("Extracted grades:", Object.keys(result.grades || {}).length, "subjects");
          resolve({ statusCode: 200, headers, body: JSON.stringify(result) });

        } catch(e) {
          console.error("Parse error:", e.message);
          resolve({ statusCode: 500, headers, body: JSON.stringify({ error: "خطأ في المعالجة: " + e.message }) });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 504, headers, body: JSON.stringify({ error: "انتهت مهلة الاتصال — حاول مجدداً" }) });
    });

    req.on('error', e => {
      resolve({ statusCode: 500, headers, body: JSON.stringify({ error: "خطأ في الشبكة: " + e.message }) });
    });

    req.write(requestBody);
    req.end();
  });
};
