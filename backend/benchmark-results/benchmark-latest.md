# Kết quả benchmark (Petstore 3.0 rút gọn)

- Thời điểm chạy: 2026-11-13T11:11:09.095Z · Node v24.15.0
- Đặc tả: 13 endpoint, 18 cạnh phụ thuộc, 4 tầng Kahn

## 1. Thời gian tạo ca kiểm thử (đo thực, 10 lần)

| Min | Median | P95 | Max |
|---|---|---|---|
| 29.77 ms | 41.63 ms | 54.85 ms | 54.85 ms |

parse + dereference + normalize + DAG + Kahn + generate all cases; database writes stubbed in memory (real inserts add I/O latency).

## 2. Số lượng ca sinh tự động (đo thực): **96 ca**

| Loại | Số ca |
|---|---|
| VALID | 13 |
| NEGATIVE | 66 |
| BOUNDARY | 17 |

## 3. Phát hiện lỗi hợp đồng trên mock có cài lỗi

Hệ thống phát hiện **11/11** (100%); mô hình Postman chỉ kiểm tra mã trạng thái phát hiện **1/11** (9.09%).
Lần chạy đối chứng trên server không lỗi: 13 ca hợp lệ, **0 báo sai**.

| # | Lỗi cài đặt | Endpoint | Hệ thống | Postman (chỉ kiểm mã trạng thái) |
|---|---|---|---|---|
| F1 | Sai kiểu: id (integer) trả về chuỗi | `GET /pet/{petId}` |  ✅ | ❌ |
| F2 | Thiếu trường bắt buộc: name | `GET /pet/{petId}` |  ✅ | ❌ |
| F3 | Giá trị null ở trường không cho phép null: name | `GET /pet/{petId}` |  ✅ | ❌ |
| F4 | Giá trị ngoài enum: status = "sleeping" | `GET /pet/{petId}` |  ✅ | ❌ |
| F5 | Sai kiểu ở đối tượng lồng nhau: category.id là chuỗi | `GET /pet/{petId}` |  ✅ | ❌ |
| F6 | Sai kiểu phần tử mảng: photoUrls chứa số | `GET /pet/{petId}` |  ✅ | ❌ |
| F7 | Sai định dạng: shipDate không phải date-time | `GET /store/order/{orderId}` |  ✅ | ❌ |
| F8 | Số thực ở trường integer: quantity = 1.5 | `GET /store/order/{orderId}` |  ✅ | ❌ |
| F9 | Sai kiểu gốc: danh sách trả về đối tượng | `GET /pet/findByStatus` |  ✅ | ❌ |
| F10 | Sai mã trạng thái: trả 204 thay vì 200 | `GET /user/{username}` |  ✅ | ✅ |
| F11 | Vi phạm định dạng email | `GET /user/{username}` |  ✅ | ❌ |

> Cột Postman là **mô hình** của bài test mặc định `pm.response.to.have.status(...)`, không phải số đo trên người thật. Người dùng Postman có thể tự viết script kiểm tra schema và đạt kết quả tương đương, với chi phí viết tay cho từng endpoint.

## 4. Chưa đo bằng script (cần đo thủ công theo benchmark/PROTOCOL.md)

- Thời gian một người tự viết collection Postman cho cùng đặc tả.
- Số ca kiểm thử người đó tạo ra.
