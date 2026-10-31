-- CreateTable
CREATE TABLE "City" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "City_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "District" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("cityCode","code")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_name_key" ON "City"("name");

-- CreateIndex
CREATE INDEX "District_cityCode_idx" ON "District"("cityCode");

-- CreateIndex
CREATE UNIQUE INDEX "District_cityCode_name_key" ON "District"("cityCode", "name");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_cityCode_districtCode_fkey" FOREIGN KEY ("cityCode", "districtCode") REFERENCES "District"("cityCode", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_cityCode_fkey" FOREIGN KEY ("cityCode") REFERENCES "City"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
