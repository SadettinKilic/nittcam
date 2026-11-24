# Delta NC (Delta Electronics, Tayvan)
> Durum: kısa araştırma notu, makinede doğrulanmadı. Güven: düşük-orta (G/M kod bölümü Delta'nın "NC Series Command Guidelines" (2016-09) belgesinden okundu; ahşap/router'a özel Delta belgesi, dosya kuralları ve yorum sözdizimi bulunamadı).

## Özet (post yazacak kişi için)
- Delta NC serisi (NC300 ailesi; NC311 bu ailede listeleniyor [4]) Fanuc tarzı ISO okur: `G20/G21`, G90/G91, G54..G59, G43/G44/G49, G73-G89 döngüleri, M98/M99, G65/G66 makro [1].
- Yay: I/J/K **başlangıçtan merkeze artımlı**; R de var [1]. Kod tablosunda G90.1/G91.1 yok [1].
- Dwell: `G04 X1.5` (saniye, 0.001-99999.999) veya `G04 P1500` (ms, noktasız, 1-99999999); ikisi de 1.5 s [1].
- Uzunluk telafisi `G43 Z_ H_` [1]. Takım değişimi M06; kılavuza göre M06 sistem tanımlı değil, MLC'de (Delta'nın PLC'si) makine üreticisi tanımlar [1]. Sistem tanımlı M-kodları yalnız M00, M01, M02, M30, M98, M99 [1].
- Ek iş koordinatları `G10 L20 P1..P64` ile ayarlanıyor (64 adet) [1]. Programda nasıl seçildiği (`G54.1 P` gibi) bu notta okunmadı: bilinmiyor.
- Ahşap router'larda ne kadar yaygın olduğu, dosya uzantısı, yorum sözdizimi, satır sonu: **bilinmiyor**. NC300 donanımında G-kodu CF kartta saklanıyor ve önde USB portu var [1][2].
- Öneri: Delta için ayrı post yazmak yerine "Fanuc-benzeri genel ISO" postu (G21, IJ artımlı, `G04 P` ms, `( )` yorum) kullanılabilir. Gerçek bir Delta makinesi gelene kadar bu not yeterli.

## Bilinenler (kısa)
| Konu | Bilgi | Kaynak |
|---|---|---|
| Birim | G20 inç, G21 mm; ikisi aynı programda kullanılmamalı | [1] |
| Yay | G02/G03, IJK artımlı (başlangıçtan merkeze), R | [1] |
| Dwell | X = s (noktalı), P = ms (noktasız) | [1] |
| Takım boyu | `G43 Z H`, `G44 Z H`, `G49`; G28 sırasında G43 etkin kalır | [1] |
| Koordinat | G54..G59, G53, G52, G92, ek koordinat P1..P64 | [1] |
| M-kodları | M00/M01/M02/M30/M98/M99 sistem tanımlı; M03-M09, M19 vb. MLC'de (üreticiye bağlı) | [1] |
| Alt program | `M98 P L`, 8 seviyeye kadar iç içe | [1] |
| Döngüler | G73, G74, G76, G80-G89; dipte bekleme P (1/1000 s, noktasız) | [1] |
| Makro | `G65`, `G66/G67`; parametreyle G/M koduna makro bağlanabiliyor (O9010-O9019 G-kodu, O9020+ M-kodu) | [1][2] |
| Program numarası | Örnekler `O0001`, `O1000` biçiminde | [1] |
| Yorum | Belgede bulunamadı (bilinmiyor). Fanuc tarzı `( )` varsayılabilir, doğrula | - |
| Vakum/pim/toz | Belgede yok: MLC'de **makine üreticisine bağlı** | [1] |
| Dosya/USB | USB portu ve CF kart var; uzantı ve ad kuralları bilinmiyor | [1][2] |

## Post için ayar önerisi (geçici)
`modal.words: G21 G90 G94 G17 G40 G49 G80 G54`, `arcs.mode: ijIncremental`, `arcs.distanceModeWord: null`, `dwell.word: P`, `dwell.unit: ms`, `dwell.decimals: 0`, `comments.style: paren` (doğrula), `toolChange.mode: manual` + `M00` (ATC'de `T.. M06` üreticiye bağlı), `file.extension: .nc` (varsayım), sayılar her zaman noktalı (Fanuc alışkanlığı; Delta'da noktasız sayının yorumu bilinmiyor).

## Makinede doğrulanması gerekenler
Yorum sözdizimi, dosya adı/uzantı, noktasız sayı birimi, M06 ve yardımcı M-kodları (MLC), ek koordinat seçimi, ahşap modeli (NC311 vb.) için ayrı bir kılavuz olup olmadığı.

## Kaynaklar
1. Delta Electronics, Delta CNC Solution, NC Series Command Guidelines (Eylül 2016). https://deltronic.ru/content/files/CNC_NC_CM_EN_20160912[1].pdf (erişim 2026-11-23) [maker manual, distribütör kopyası]
2. Delta Electronics, NC300 Maintenance Manual (nc300_m_en_20130419). https://astrahan.cnc360.ru/files/327/nc300_m_en_20130419.pdf (erişim 2026-11-23) [maker manual, distribütör kopyası]
3. Scribd, "NC300 GCode Programming Manual" (DELTA_NC300_CM_EN_20140425). https://www.scribd.com/document/841655711/NC300-GCode-Programming-Manual (erişim 2026-11-23) [arama özeti, belge açılamadı]
4. manuals.plus, "台達 NC300 系列 CNC 控制器" (NC311A-MS-A modelinin NC300 serisinde listelendiği). https://manuals.plus/m/67b76b8c570c07fd0d15a3c513c34e9e6297895d12d9678d661822b0aee86638 (erişim 2026-11-23) [arama özeti, belge açılamadı]
5. Delta Electronics, NC5 Series G Command Guidelines (delta-ia-cnc-nc5-pm-en-20231222). https://deltronics.ru/images/manual/CNC/delta-ia-cnc-nc5-pm-en-20231222.pdf (erişim 2026-11-23) [arama özeti, belge açılamadı (HTTP 502)]
