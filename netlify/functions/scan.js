// موجه البرامج الذكي — Netlify Function v2
// Proxy آمن مع prompt محسّن لدقة أعلى في قراءة الشهادات العُمانية

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
  console.log("API Key present:", !!apiKey);
  console.log("API Key prefix:", apiKey ? apiKey.substring(0, 15) : "NONE");

  if (!apiKey) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: "مفتاح API غير مهيأ على الخادم" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "طلب غير صالح" }) }; }

  const { image, mediaType } = body;
  if (!image || !mediaType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "بيانات الصورة مفقودة" }) };
  }
  if (image.length > 6000000) {
    return { statusCode: 413, headers,
      body: JSON.stringify({ error: "الصورة كبيرة جداً — استخدم صورة أصغر من 4MB" }) };
  }

  // ── Prompt محسّن لدقة أعلى ──
  const prompt = `أنت خبير في قراءة وثائق الثانوية العامة العُمانية (دبلوم التعليم العام).

مهمتك: استخراج البيانات من هذه الشهادة/الجدول بدقة تامة.

تعليمات مهمة:
١. اقرأ كل خلية بعناية — لا تخمّن أو تقرّب الأرقام
٢. الدرجات عادةً بين 40 و 100
٣. إذا لم تستطع قراءة قيمة بوضوح، اكتب null
٤. الفصل الأول = الفترة الدراسية الأولى، الفصل الثاني = الفترة الثانية
٥. انتبه لأسماء المواد — قد تكون مكتوبة بطريقة مختلفة

جدول مطابقة أسماء المواد بأكوادها:
التربية الإسلامية / الإسلامية → تربية_اسلامية
اللغة العربية / العربية / عربي → عربي
اللغة الإنجليزية / الإنجليزية / إنجليزي → انجليزي
الدراسات الاجتماعية / التربية الوطنية / وطني → دراسات_اجتماعية
الرياضيات المتقدمة / رياضيات متقدمة → رياضيات_متقدمة
الرياضيات الأساسية / رياضيات أساسية / رياضيات → رياضيات_اساسية
الفيزياء → فيزياء
الكيمياء → كيمياء
الأحياء / علم الأحياء / الأحياء البيئية → احياء
تقنية المعلومات / الحاسب / الحاسوب → تقنية_معلومات
الجغرافيا الاقتصادية / الجغرافيا → جغرافيا
التاريخ → تاريخ
العلوم والتقانة / علوم تقانة / البيئة → علوم_تقانة
اللغة الإنجليزية المتقدمة / إنجليزي متقدم → انجليزي_متقدم
الفنون التشكيلية / الفنون → فنون_تشكيلية
المهارات الموسيقية / الموسيقى → موسيقى
الرياضة المدرسية / الرياضة / التربية البدنية → رياضة
إدارة الأعمال → ادارة_اعمال
اللغة الفرنسية / فرنسي → فرنسي
اللغة الألمانية / ألماني → الماني

أعد JSON فقط بلا أي نص أو شرح خارجه:
{
  "name": "الاسم الكامل للطالب أو null",
  "gender": "ذكر أو أنثى أو null",
  "grades": {
    "كود_المادة": {"f1": رقم_الفصل_الاول, "f2": رقم_الفصل_الثاني}
  },
  "math_type": "رياضيات_متقدمة أو رياضيات_اساسية أو null",
  "electives": ["كود1", "كود2", "كود3"],
  "confidence": "high أو medium أو low",
  "notes": "أي ملاحظات عن صعوبة القراءة أو قيم غير واضحة"
}`;

  const requestBody = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
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
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log("Anthropic status:", res.statusCode);
        if (res.statusCode !== 200) {
          console.error("Anthropic error:", data);
          resolve({ statusCode: 502, headers,
            body: JSON.stringify({ error: "خطأ في الاتصال بالخادم (" + res.statusCode + ")" }) });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || [])
            .filter(b => b.type === "text").map(b => b.text).join("");
          console.log("Response text:", text.substring(0, 200));
          const match = text.match(/\{[\s\S]*\}/);
          if (!match) {
            resolve({ statusCode: 422, headers,
              body: JSON.stringify({ error: "لم أتمكن من قراءة الشهادة — تأكد من وضوح الصورة وأنها تحتوي على جدول الدرجات" }) });
            return;
          }
          const result = JSON.parse(match[0]);
          // تنظيف القيم الفارغة
          if (result.grades) {
            Object.keys(result.grades).forEach(k => {
              const g = result.grades[k];
              if (g.f1 === null || g.f1 === undefined) delete result.grades[k];
              if (g.f2 === null || g.f2 === undefined) delete result.grades[k];
            });
          }
          console.log("Extracted grades count:", Object.keys(result.grades || {}).length);
          resolve({ statusCode: 200, headers, body: JSON.stringify(result) });
        } catch (e) {
          console.error("Parse error:", e.message);
          resolve({ statusCode: 500, headers,
            body: JSON.stringify({ error: "خطأ في معالجة الاستجابة: " + e.message }) });
        }
      });
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
