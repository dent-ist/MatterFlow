using LptHub.Identity.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LptHub.Identity.Infrastructure;

internal sealed class PersonConfiguration : IEntityTypeConfiguration<Person>
{
    public void Configure(EntityTypeBuilder<Person> b)
    {
        b.ToTable("Person");
        b.Property(x => x.FirstName).HasMaxLength(200).IsRequired();
        b.Property(x => x.LastName).HasMaxLength(200).IsRequired();
        b.Property(x => x.PersonType).HasMaxLength(10).IsUnicode(false).IsRequired();
        b.Property(x => x.Title).HasMaxLength(100);
        b.Property(x => x.Email).HasMaxLength(320);
        b.Property(x => x.Comments).HasMaxLength(2000);
        b.Property(x => x.CompanyName).HasMaxLength(200);
        b.HasOne(x => x.User).WithOne().HasForeignKey<Person>(x => x.UserId).HasConstraintName("FK_Person_User");
        b.HasIndex(x => x.UserId).IsUnique().HasFilter("[UserId] IS NOT NULL").HasDatabaseName("UQ_Person_User");
        b.HasIndex(x => new { x.LastName, x.FirstName }).HasDatabaseName("IX_Person_Name");
    }
}
