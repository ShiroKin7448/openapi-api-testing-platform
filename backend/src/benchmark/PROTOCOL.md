# Quy trình benchmark

Chạy phần tự động (từ `backend/`):

```powershell
npm run benchmark
```

Kết quả ghi vào `backend/benchmark-results/benchmark-latest.json` và `.md`. Không cần Docker, DB hay mạng.

## Đo tự động (script)

| Chỉ số | Cách đo |
| --- | --- |
| Thời gian tạo ca | `parse → dereference → normalize → DAG → Kahn → sinh toàn bộ ca`, 10 lần sau 1 lần chạy làm nóng, báo min/median/p95/max. Ghi DB được thay bằng bộ nhớ nên chưa tính độ trễ I/O. |
| Số ca và loại ca | Đếm ca VALID / NEGATIVE / BOUNDARY trên đặc tả `petstore-3.0.yaml`. |
| Phát hiện lỗi hợp đồng | Dựng server giả từ chính đặc tả, mỗi lần cài **một** lỗi (11 lỗi: sai kiểu, thiếu trường, null, enum, định dạng, mảng, lồng nhau, mã trạng thái...). Chạy ca VALID của endpoint bị cài lỗi, kiểm tra bằng `ContractValidatorService`. |
| Báo sai (false positive) | Chạy 13 ca VALID trên server không lỗi, số lần báo lỗi phải bằng 0. |

## Mô hình, không phải số đo

Cột "Postman" trong báo cáo là **mô hình** bài test mặc định chỉ kiểm tra mã trạng thái
(`pm.response.to.have.status(...)`). Người dùng Postman có thể tự viết script kiểm tra schema và đạt kết quả
tương đương, với chi phí viết tay cho từng endpoint. Luận văn cần nêu rõ điều này.

## Phải đo thủ công (script không làm được)

Khi chưa có số đo thật, **không** đưa các con số "4–6 giờ" hay "5–10 ca" vào luận văn.

1. Chọn 2–3 người có biết Postman, đưa cùng file `petstore-3.0.yaml`.
2. Yêu cầu: tạo collection kiểm thử cho 13 endpoint gồm ca hợp lệ, ca thiếu trường bắt buộc, ca sai kiểu, ca vượt biên, và assertion kiểm tra schema phản hồi.
3. Bấm giờ từ lúc bắt đầu đến khi collection chạy được trên server giả sạch; ghi số ca và số assertion.
4. Chạy collection của họ trên 11 server giả có lỗi (cùng bộ lỗi `FAULTS` trong `run-benchmark.ts`) để có tỷ lệ phát hiện thực tế của Postman.
5. Báo trung bình và độ lệch, kèm số năm kinh nghiệm của từng người.

## Hạn chế cần nêu trong luận văn

- Một đặc tả duy nhất (Petstore rút gọn, có thêm vài ràng buộc min/max/độ dài để sinh ca biên).
- Số ca phụ thuộc vào ràng buộc có trong đặc tả; đặc tả ít ràng buộc sẽ sinh ít ca hơn.
- Lỗi được cài có chủ đích thuộc loại vi phạm hợp đồng; lỗi nghiệp vụ không nằm trong phạm vi.
- Bộ phân tích phụ thuộc dùng heuristic theo tên trường; đặc tả có `id` bắt buộc trong request body có thể tạo chu trình giả (đã gặp khi thử nghiệm).
