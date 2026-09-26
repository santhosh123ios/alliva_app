ALTER TABLE "Branch" ADD COLUMN "managerId" UUID;
CREATE INDEX "Branch_managerId_idx" ON "Branch"("managerId");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
