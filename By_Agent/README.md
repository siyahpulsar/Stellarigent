# By_Agent — Ajan Çıktı ve Serbest Çalışma Alanı

> **Konum:** `By_Agent/` (veya `By_Agent/` alt dizinleri)  
> **Erişim Yetkisi:** Tam Yetki (Okuma, Yazma, Dizin Oluşturma, Komut Yürütme)

Bu klasör, **Stellarigent** yapay zeka ajanının kullanıcının verdiği görevleri yerine getirirken kullanıcıya teslim edeceği nihai çıktıları, raporları, yeni oluşturulan yazılım projelerini ve veri dosyalarını üretmesi için ayrılmış birincil çalışma alanıdır.

---

## 1. Amacı ve Mimari Rolü

Stellarigent sistemi, ana işletim sistemini ve kendi kaynak kodlarını (`src/**`, `server.js`, `package.json`, `.env`, `config/`) korumak için **Proje Çekirdek Kalkanı** uygular. Ajanın sistem dosyalarını değiştirmesi kesinlikle engellenmiştir.

Buna karşılık, kullanıcının talep ettiği tüm üretimler `By_Agent/` klasörü içerisinde tamamen serbestçe gerçekleştirilir:
- Kullanıcı için yazılan yeni web siteleri, scriptler veya uygulamalar
- Araştırma ve analiz sonucunda hazırlanan Markdown raporları
- Dışa aktarılan veri tabloları, JSON veri kümeleri veya CSV dosyaları
- Kullanıcıya sunulmak üzere üretilen grafik ve görsel tasarımlar

---

## 2. Dizin İçi Organizasyon Standartları

`By_Agent/` içinde düzeni korumak için aşağıdaki alt klasör yapısı önerilir:

```
By_Agent/
├── reports/              # Kullanıcıya sunulacak analiz, inceleme ve özet raporları (.md, .txt)
├── projects/             # Ajan tarafından sıfırdan üretilen yazılım projeleri (HTML, JS, Python vb.)
├── data/                 # Üretilen veya filtrelenen veri setleri (.json, .csv)
└── images/               # İndirilen veya oluşturulan grafik ve görsel materyaller
```

---

## 3. Güvenlik ve İzolasyon Garantileri

1. **Çekirdekten Tam İzolasyon:** `By_Agent/` içerisindeki dosyalar bağımsızdır; projenin çalışmasını veya sunucunun bütünlüğünü etkilemez.
2. **Kabuk Çalıştırma Güvenliği:** Ajan `execute_command` ile bir script veya test çalıştırırken çalışma dizini (`cwd`) olarak `By_Agent/` klasörünü güvenle kullanabilir.
3. **Kullanıcıya Teslim Protokolü:** Bu klasörde üretilen bir dosya, `send_discord_message` aracı ile `filePath: "By_Agent/reports/analiz.md"` şeklinde doğrudan kullanıcının Discord kanalına ek olarak iletilebilir veya Web Kontrol Paneli dosya gezgininden indirilebilir.
