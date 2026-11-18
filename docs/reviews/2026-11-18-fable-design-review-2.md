# Fable tasarım incelemesi #2 (2026-11-18)

Kapsam: main `05ef611` (B4a, B4b, B9 sonrası). Kaynak: `e2e/visual-baselines/*.png` (1440 ve 390 px, açık/koyu): Ana sayfa, Parçalar (Liste ve Çizim), Dizilim, Simülasyon. Uygulama bu incelemede çalıştırılmadı; etkileşim (sürükleme, yakınlaştırma, alt sayfalar) görüntülerden değil, görev kabul maddelerinden değerlendirildi. İnceleme #1: `2026-11-18-fable-design-review-1.md`.

## Puanlar

| Başlık | #1 | #2 | Not |
| --- | --- | --- | --- |
| Kurumsal imaj / marka | 5 | 6,5 | NittCAM yazı logosu, mono ölçüler ve ortak tuval dili kimlik veriyor; kabuk hâlâ "standart indigo SaaS" |
| Modernlik | 7 | 7,5 | Çizim tahtası (cetvel, nokta ızgara, durum çubuğu) güncel bir CAD hissi veriyor |
| Kullanılabilirlik | 6,5 | 7 | Tuval öncelikli düzen iyi; telefonda tahta sıkışık, panellerde fazla metin var |
| M3–M6 için hazır olma | 6 | 7 | `WorkspaceLayout` ve tuval dili sağlam temel; araç durumu dili ve tuval bütçesi kuralı eksikti (D-039) |

## İyi olanlar
- Tuval dili tutarlı: parça etiketi (numara + ad + mono ölçü), seçim çipi "596 × 716", cetveller, ölçek çubuğu. Dizilim, Simülasyon ve Çizim aynı ürüne ait görünüyor.
- Koyu tema açık temadan daha iyi: parça / plaka / zemin ayrımı net.
- "Profil doğrulanmadı" tek çipe indi; ekranlar sakinleşti.
- Ana sayfadaki 3 adımlı başlangıç şeridi (Makine, Kesim listesi, G-code) ürünü ilk bakışta anlatıyor.

## Sorunlar (önem sırasıyla)

1. **Telefonda çizim tahtası sıkışık ve durum çubuğu kapalı** (Parçalar › Çizim, 390 px, iki tema). Durum çubuğu "Parçalar / Özellikler" düğme şeridinin arkasında kalıyor. Proje adı bloğu + adım kartı + Liste/Çizim satırı ekranın ilk 337 pikselini alıyor; tuvale yüksekliğin yaklaşık %46'sı kalıyor (T198 hedefi %55). Araç rayı sol cetvel rakamlarını örtüyor. Çözüm: telefonda tek satırlık sihirbaz başlığı (adım adı + 2/5 ilerleme çizgisi), geçiş düğmesi tuval araç şeridine, durum çubuğu düğme şeridinin üstüne. → T240
2. **Masaüstünde tuval ekranın küçük bir parçası** (Parçalar › Çizim, 1440 × 900). Tuval yaklaşık 548 px genişlikte: 1440'ın %38'i. Sol "Parçalar" paneli 300 px ve Liste görünümünü tekrar ediyor; Liste/Çizim düğmesi ve panel daraltma düğmeleri kendi boş satırlarını kullanıyor. Çizim araçları gelince bu alan yetmez. Çözüm: paneller 232 / 264 px, geçiş düğmesi başlık satırına, daraltma düğmeleri panel başlığına; hedef ≥ 640 × 660 px. → T241
3. **Araç rayında çalışmayan araçlar ve araç durumu dili yok** (Çizim, tüm boyutlar). Dikdörtgen, daire, çizgi, yay simgeleri gri ve ölü duruyor; etkin araç yalnızca hafif bir zeminle belli. B10 bu araçları açacak ama "çizim sürerken ekran nasıl görünür" tanımlı değildi. Çözüm: D-039 araç durumu dili (dolu vurgu rengi etkin araç, kesikli önizleme, imleçte mono değer çipi, durum çubuğunda tek satır ipucu, çalışmayan araç gösterilmez). → T127–T129 kabul maddelerine işlendi
4. **Özellikler panelinde sıkışık düğmeler ve düz yazı kısayol listesi** (Çizim, 1440). "Yatay aynala" / "Dikey aynala" yazıları düğme kenarına değiyor; altta üç satırlık "Kısayollar: Ctrl+C …" paragrafı var. Çözüm: ipuçlu simge düğme satırı, kısayollar mevcut kısayol penceresine, telefonda seçimin üstünde mini araç çubuğu. → T242
5. **Tahtada ölçek ve referans yok** (Çizim, tüm boyutlar). Parçalar sonsuz bir ızgarada duruyor; orijin 4 piksellik bir nokta; 5 parça tuvalin yaklaşık dörtte birini kullanıyor. Kullanıcı plakaya göre ne kadar yer tuttuğunu göremiyor. Çözüm: belirgin X/Y orijin işareti, plaka boyutunda kesikli referans çerçevesi (yalnızca görüntü), içeriğe sığdırma. → T243
6. **Dizilim panelleri metin ağırlıklı** (Dizilim, 1440). Sol "Dizilim" kartı ayarları düz yazıyla tekrar ediyor; plaka özeti hem solda hem sağda; sağ panel üç kart dolusu açıklama; ızgara araçları sekmelerin altında ayrı satırda ve plaka tuvalin üstüne yapışık. → T244 (B6 ile)
7. **Simülasyonda "Oynat" pasif görünüyor** (Simülasyon, 1440 açık tema). Ekranın ana eylemi soluk mavi; altı büyük KPI kutusu sol paneli dolduruyor; aynı bölgede iki bilgi metni var; tabla kesikli çizgisi sağda kesiliyor. → T245 (B6 ile)
8. **Kesim listesinde kalıcı yeşil şerit ve boş "Uyarılar" paneli** (Parçalar › Liste, 1440). "5 satır eklendi" tam genişlikte kalıcı şerit; "Sorun bulunmadı" demek için 270 px sütun ayrılmış. → T246 (B7 ile)
9. **Kabukta tekrarlar** (tüm ekranlar, 1440). "Kaydedildi" hem üst çubukta hem alt çubukta; "Oluştur" ile "Yeni proje" aynı yere gidiyor (FQ4, tasarım yetkisiyle karar: kalkıyor); "Proje adı" küçük başlığı gereksiz. → T247 (B8 ile)

## Çıktılar
- Kural: `docs/DECISIONS.md` D-039 (tuval bütçesi, tek araç durumu dili, panellerde değer var düz yazı yok).
- `docs/BACKLOG.md`: T127–T129 kabul maddeleri güncellendi; yeni **B10a** = T240–T243 (B10'dan hemen sonra); T244–T247 ilgili partilere eklenir (B6, B6, B7, B8). Sıra değişmedi.
- Not: BACKLOG'da T194 / T194a / T195 hâlâ `todo`, B9 görevleri `review` görünüyor; ikisi de birleştirildi (#39, #42). Durumları PO güncellemeli.
