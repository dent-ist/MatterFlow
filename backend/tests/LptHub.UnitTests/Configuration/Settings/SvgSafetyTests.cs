using System.Text;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Settings;

public class SvgSafetyTests
{
    private const string Good = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0B5FFF"/></svg>""";

    private static string Wrap(string inner, string rootAttributes = "") =>
        $"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" {rootAttributes}>{inner}</svg>""";

    private static Result<IconInfo> Check(string svg) => IconInspector.Inspect(Encoding.UTF8.GetBytes(svg));

    private static void ShouldBeUnsafe(string svg) => Check(svg).Error!.Code.ShouldBe(ErrorCodes.BrandingIconUnsafe);

    [Fact]
    public void A_plain_square_svg_passes()
    {
        var info = Check(Good).Value;
        info.Kind.ShouldBe(IconKind.Svg);
        info.ContentType.ShouldBe("image/svg+xml");
        info.KindCode.ShouldBe("svg");
    }

    [Fact]
    public void An_svg_with_an_xml_declaration_bom_and_comments_passes()
    {
        var bytes = new byte[] { 0xEF, 0xBB, 0xBF }.Concat(Encoding.UTF8.GetBytes("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- exported -->\n" + Good)).ToArray();
        IconInspector.Inspect(bytes).IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void A_realistic_icon_with_gradients_groups_and_a_title_passes()
    {
        var svg = Wrap("""
            <title>Logo</title><desc>A logo</desc>
            <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
            <clipPath id="c"><circle cx="32" cy="32" r="30"/></clipPath><linearGradient id="g2" xlink:href="#g1"/></defs>
            <g clip-path="url(#c)" transform="rotate(10 32 32)"><path d="M0 0L64 64" stroke="url(#g1)" style="fill:#ff0000;opacity:.8"/><use href="#c" x="2"/><use xlink:href="#c"/></g>
            """);
        Check(svg).IsSuccess.ShouldBeTrue();
    }

    [Theory]
    [InlineData("""<script>alert(1)</script>""")]
    [InlineData("""<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>""")]
    [InlineData("""<image href="https://example.com/x.png" width="10" height="10"/>""")]
    [InlineData("""<image href="data:image/png;base64,AAAA" width="10" height="10"/>""")]
    [InlineData("""<a href="https://example.com"><rect width="1" height="1"/></a>""")]
    [InlineData("""<style>rect{fill:red}</style>""")]
    [InlineData("""<rect width="1" height="1"><animate attributeName="x" to="5"/></rect>""")]
    [InlineData("""<rect width="1" height="1"><set attributeName="x" to="5"/></rect>""")]
    [InlineData("""<animateTransform attributeName="transform"/>""")]
    [InlineData("""<iframe src="x"/>""")]
    [InlineData("""<filter id="f"><feImage href="x"/></filter>""")]
    [InlineData("""<switch><rect width="1" height="1"/></switch>""")]
    [InlineData("""<symbol id="s"><rect width="1" height="1"/></symbol>""")]
    [InlineData("""<text x="1" y="1">hello</text>""")]
    public void A_forbidden_element_is_rejected(string inner) => ShouldBeUnsafe(Wrap(inner));

    [Theory]
    [InlineData("""<rect width="1" height="1" onclick="alert(1)"/>""")]
    [InlineData("""<rect width="1" height="1" onload="x()"/>""")]
    [InlineData("""<rect width="1" height="1" onmouseover="x()"/>""")]
    [InlineData("""<rect width="1" height="1" data-x="1"/>""")]
    [InlineData("""<rect width="1" height="1" filter="url(#f)"/>""")]
    [InlineData("""<rect width="1" height="1" xml:lang="en"/>""")]
    [InlineData("""<rect width="1" height="1" xlink:title="x"/>""")]
    [InlineData("""<rect width="1" height="1" a:b="x" xmlns:a="http://example.com/"/>""")]
    public void A_forbidden_attribute_is_rejected(string inner) => ShouldBeUnsafe(Wrap(inner));

    [Theory]
    [InlineData("""<use href="https://example.com/a.svg#x"/>""")]
    [InlineData("""<use xlink:href="//evil.example/a.svg#x"/>""")]
    [InlineData("""<use href="a.svg#x"/>""")]
    [InlineData("""<use href="javascript:alert(1)"/>""")]
    [InlineData("""<use href="data:image/svg+xml;base64,AAAA"/>""")]
    [InlineData("""<use href=""/>""")]
    [InlineData("""<use href="#"/>""")]
    [InlineData("""<rect href="#a" width="1" height="1"/>""")]
    [InlineData("""<g><path href="#a" d="M0 0"/></g>""")]
    public void An_href_that_is_not_a_fragment_on_an_allowed_element_is_rejected(string inner) => ShouldBeUnsafe(Wrap(inner));

    [Theory]
    [InlineData("""<rect width="1" height="1" fill="url(https://evil.example/x)"/>""")]
    [InlineData("""<rect width="1" height="1" fill="url(data:image/png;base64,AAAA)"/>""")]
    [InlineData("""<rect width="1" height="1" fill="url( 'http://evil.example/x' )"/>""")]
    [InlineData("""<rect width="1" height="1" style="fill:url(http://evil.example/x)"/>""")]
    [InlineData("""<rect width="1" height="1" style="fill: URL (//evil.example/x)"/>""")]
    [InlineData("""<rect width="1" height="1" fill="javascript:alert(1)"/>""")]
    [InlineData("""<rect width="1" height="1" fill="  JaVa&#x09;Script:alert(1)"/>""")]
    [InlineData("""<rect width="1" height="1" fill="data:text/html,x"/>""")]
    [InlineData("""<rect width="1" height="1" style="fill:red;behavior:url(#x)"/>""")]
    [InlineData("""<rect width="1" height="1" style="@import 'x'"/>""")]
    [InlineData("""<rect width="1" height="1" style="fill:expression(alert(1))"/>""")]
    [InlineData("""<rect width="1" height="1" style="fill:\75rl(http://x)"/>""")]
    [InlineData("""<rect width="1" height="1" style="-moz-binding:x"/>""")]
    public void A_dangerous_value_is_rejected(string inner) => ShouldBeUnsafe(Wrap(inner));

    [Fact]
    public void A_doctype_is_rejected() =>
        ShouldBeUnsafe("""<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">""" + Good);

    [Fact]
    public void An_entity_declaration_is_rejected() =>
        ShouldBeUnsafe("""<!DOCTYPE svg [<!ENTITY x "boom">]>""" + Wrap("""<title>&x;</title>"""));

    [Fact]
    public void A_billion_laughs_document_is_rejected_before_expansion()
    {
        var svg = """<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>&lol2;</title></svg>""";
        ShouldBeUnsafe(svg);
    }

    [Fact]
    public void An_external_entity_is_rejected() =>
        ShouldBeUnsafe("""<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>""" + Wrap("""<title>&xxe;</title>"""));

    [Fact]
    public void A_processing_instruction_is_rejected() =>
        ShouldBeUnsafe("""<?xml-stylesheet href="evil.css"?>""" + Good);

    [Fact]
    public void An_undeclared_entity_reference_is_a_corrupt_file() =>
        Check(Wrap("""<title>&nbsp;</title>""")).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void Text_outside_title_and_desc_is_rejected() => ShouldBeUnsafe(Wrap("""<g>hello</g>"""));

    [Fact]
    public void Cdata_outside_title_and_desc_is_rejected() => ShouldBeUnsafe(Wrap("""<g><![CDATA[ alert(1) ]]></g>"""));

    [Fact]
    public void A_foreign_namespace_on_the_root_attributes_is_rejected() =>
        ShouldBeUnsafe("""<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xhtml" viewBox="0 0 8 8"/>""");

    [Fact]
    public void An_element_in_another_namespace_is_rejected() =>
        ShouldBeUnsafe(Wrap("""<rect xmlns="http://www.w3.org/1999/xhtml"/>"""));

    [Fact]
    public void Too_many_use_elements_are_rejected() =>
        ShouldBeUnsafe(Wrap("<defs><g id=\"a\"/></defs>" + string.Concat(Enumerable.Repeat("<use href=\"#a\"/>", 21))));

    [Fact]
    public void Too_deep_nesting_is_rejected() =>
        ShouldBeUnsafe(Wrap(string.Concat(Enumerable.Repeat("<g>", 40)) + string.Concat(Enumerable.Repeat("</g>", 40))));

    [Fact]
    public void Too_many_elements_are_rejected() =>
        ShouldBeUnsafe(Wrap(string.Concat(Enumerable.Repeat("<g/>", 2001))));

    [Fact]
    public void An_html_document_is_unsupported_not_unsafe() =>
        Check("<html xmlns=\"http://www.w3.org/1999/xhtml\"><body/></html>").Error!.Code.ShouldBe(ErrorCodes.BrandingIconTypeUnsupported);

    [Fact]
    public void An_svg_in_another_namespace_is_unsupported() =>
        Check("""<svg xmlns="http://example.com/other" viewBox="0 0 8 8"/>""").Error!.Code.ShouldBe(ErrorCodes.BrandingIconTypeUnsupported);

    [Theory]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64.01"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="32"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" width="64px" height="64em"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg"/>""")]
    public void A_non_square_svg_is_refused(string svg) => Check(svg).Error!.Code.ShouldBe(ErrorCodes.BrandingIconNotSquare);

    [Theory]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,24,24"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 10.5 10.5" width="48px" height="48px"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>""")]
    public void A_small_square_svg_has_no_minimum_size(string svg) => Check(svg).IsSuccess.ShouldBeTrue();

    [Theory]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="a b c d"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -4 -4"/>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 NaN NaN"/>""")]
    public void A_broken_viewbox_is_corrupt(string svg) => Check(svg).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Theory]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><g></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"")]
    [InlineData("<svg")]
    public void Malformed_xml_is_corrupt(string svg) => Check(svg).Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void Invalid_utf8_is_corrupt() =>
        IconInspector.Inspect([.. Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><title>"), 0xC3, 0x28, .. Encoding.UTF8.GetBytes("</title></svg>")])
            .Error!.Code.ShouldBe(ErrorCodes.BrandingIconCorrupt);

    [Fact]
    public void An_svg_bytes_check_ignores_the_declared_xml_encoding() =>
        Check("""<?xml version="1.0" encoding="ISO-8859-1"?>""" + Good).IsSuccess.ShouldBeTrue();

    [Fact]
    public void Every_rejection_carries_a_message_for_the_file_field()
    {
        var error = Check(Wrap("<script/>")).Error!;
        error.Type.ShouldBe(ErrorType.Validation);
        error.FieldErrors!["file"][0].Message.ShouldNotBeNullOrWhiteSpace();
    }
}
